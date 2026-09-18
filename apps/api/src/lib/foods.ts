import type { FoodResponse } from '@eats/shared';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Database, Executor } from '../db/client.ts';
import { foods, foodServings, logEntries } from '../db/schema.ts';
import type { OffProduct } from './off.ts';

/** Re-pull a cached Open Food Facts product after this long. */
const OFF_CACHE_DAYS = 30;

type FoodRow = typeof foods.$inferSelect;
type ServingRow = typeof foodServings.$inferSelect;

export function toFoodResponse(
  food: FoodRow,
  servings: ServingRow[] = [],
): FoodResponse {
  return {
    id: food.id,
    source: food.source,
    name: food.name,
    brand: food.brand,
    barcode: food.barcode,
    kcal100g: food.kcal100g,
    protein100g: food.protein100g,
    carbs100g: food.carbs100g,
    fat100g: food.fat100g,
    servings: servings.map((s) => ({ id: s.id, label: s.label, grams: s.grams })),
  };
}

/** Attach servings to a set of foods in one query rather than N. */
export async function withServings(
  db: Database,
  rows: FoodRow[],
): Promise<FoodResponse[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const servings = await db
    .select()
    .from(foodServings)
    .where(sql`${foodServings.foodId} = ANY(${ids})`);

  const byFood = new Map<string, ServingRow[]>();
  for (const s of servings) {
    const list = byFood.get(s.foodId);
    if (list) list.push(s);
    else byFood.set(s.foodId, [s]);
  }
  return rows.map((r) => toFoodResponse(r, byFood.get(r.id) ?? []));
}

export const isStale = (fetchedAt: Date | null): boolean =>
  fetchedAt === null ||
  Date.now() - fetchedAt.getTime() > OFF_CACHE_DAYS * 24 * 60 * 60 * 1000;

export async function findByBarcode(
  db: Database,
  barcode: string,
): Promise<FoodRow | null> {
  const [row] = await db
    .select()
    .from(foods)
    .where(and(eq(foods.source, 'off'), eq(foods.barcode, barcode)))
    .limit(1);
  return row ?? null;
}

/**
 * Write an Open Food Facts product into our own table so subsequent lookups
 * are local. Conflicts on (source, barcode), which is what makes this safe to
 * call concurrently for the same product.
 */
export async function upsertOffFood(
  db: Database,
  product: Extract<OffProduct, { status: 'ok' }>,
): Promise<FoodResponse> {
  const [row] = await db
    .insert(foods)
    .values({
      source: 'off',
      barcode: product.barcode,
      name: product.name,
      brand: product.brand,
      kcal100g: product.macros.kcal100g,
      protein100g: product.macros.protein100g,
      carbs100g: product.macros.carbs100g,
      fat100g: product.macros.fat100g,
      offFetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [foods.source, foods.barcode],
      set: {
        name: product.name,
        brand: product.brand,
        kcal100g: product.macros.kcal100g,
        protein100g: product.macros.protein100g,
        carbs100g: product.macros.carbs100g,
        fat100g: product.macros.fat100g,
        offFetchedAt: new Date(),
      },
    })
    .returning();

  if (!row) throw new Error('food upsert returned no row');

  // OFF declares at most one serving size, and it is only a suggestion.
  if (product.servingG !== null) {
    await db
      .insert(foodServings)
      .values({ foodId: row.id, label: '1 portion', grams: product.servingG })
      .onConflictDoNothing();
  }

  const servings = await db
    .select()
    .from(foodServings)
    .where(eq(foodServings.foodId, row.id));
  return toFoodResponse(row, servings);
}

/**
 * Local search: the user's own foods plus anything already pulled from OFF.
 * Matches name or brand; ILIKE is fine at this table size and avoids needing
 * the pg_trgm extension.
 */
export async function searchLocal(
  db: Database,
  userId: string,
  query: string,
  limit: number,
): Promise<FoodRow[]> {
  const pattern = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  return db
    .select()
    .from(foods)
    .where(
      and(
        or(ilike(foods.name, pattern), ilike(foods.brand, pattern)),
        // Your custom foods, or any cached OFF product.
        or(eq(foods.source, 'off'), eq(foods.createdBy, userId)),
      ),
    )
    .orderBy(desc(foods.source), foods.name)
    .limit(limit);
}

/** Most-logged foods first: the list you actually tap on the add screen. */
export async function recentFoods(
  db: Database,
  userId: string,
  limit: number,
): Promise<FoodRow[]> {
  const counts = db
    .select({
      foodId: logEntries.foodId,
      uses: sql<number>`count(*)::int`.as('uses'),
      lastUsed: sql<Date>`max(${logEntries.createdAt})`.as('last_used'),
    })
    .from(logEntries)
    .where(eq(logEntries.userId, userId))
    .groupBy(logEntries.foodId)
    .as('counts');

  const rows = await db
    .select({ food: foods })
    .from(counts)
    .innerJoin(foods, eq(foods.id, counts.foodId))
    .orderBy(desc(counts.uses), desc(counts.lastUsed))
    .limit(limit);
  return rows.map((r) => r.food);
}

export async function insertCustomFood(
  tx: Executor,
  userId: string,
  input: {
    name: string;
    brand?: string | null | undefined;
    barcode?: string | null | undefined;
    kcal100g: number;
    protein100g: number;
    carbs100g: number;
    fat100g: number;
    servings?: { label: string; grams: number }[] | undefined;
  },
): Promise<FoodRow> {
  const [row] = await tx
    .insert(foods)
    .values({
      source: 'custom',
      name: input.name,
      brand: input.brand ?? null,
      barcode: input.barcode ?? null,
      kcal100g: input.kcal100g,
      protein100g: input.protein100g,
      carbs100g: input.carbs100g,
      fat100g: input.fat100g,
      createdBy: userId,
    })
    .returning();
  if (!row) throw new Error('food insert returned no row');

  if (input.servings && input.servings.length > 0) {
    await tx
      .insert(foodServings)
      .values(input.servings.map((s) => ({ foodId: row.id, ...s })));
  }
  return row;
}
