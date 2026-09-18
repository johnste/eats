import type { FoodResponse } from '@eats/shared';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { Database, Executor } from '../db/client.ts';
import { foods, foodServings, foodViews, logEntries } from '../db/schema.ts';
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
    .where(inArray(foodServings.foodId, ids));

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
 * Local search: the user's own foods, Livsmedelsverket's Swedish staples, and
 * anything already pulled from Open Food Facts.
 *
 * Ordered by source: your own foods first, then Livsmedelsverket, then OFF.
 * Livsmedelsverket outranks OFF because it is compiled and analysed rather
 * than crowd-sourced, and because it covers generic foods -- potatis, ägg,
 * havregryn -- that OFF only has as somebody's photographed packet.
 *
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
        // Shared sources, plus your own foods -- but not another user's.
        or(
          eq(foods.source, 'off'),
          eq(foods.source, 'slv'),
          eq(foods.createdBy, userId),
        ),
      ),
    )
    .orderBy(
      sql`case ${foods.source}
            when 'custom' then 0
            when 'slv' then 1
            else 2
          end`,
      // A name that begins with the query beats one that merely contains it:
      // searching "ägg" should reach "Ägg kokt" before "Majonnäs äggfri".
      sql`case when ${foods.name} ilike ${`${query.replace(/[%_]/g, (c) => `\\${c}`)}%`} then 0 else 1 end`,
      foods.name,
    )
    .limit(limit);
}

/** Note that a user touched a food, whether or not they end up eating it. */
export async function recordFoodView(
  tx: Executor,
  userId: string,
  foodId: string,
): Promise<void> {
  await tx
    .insert(foodViews)
    .values({ userId, foodId })
    .onConflictDoUpdate({
      target: [foodViews.userId, foodViews.foodId],
      set: { viewedAt: new Date() },
    });
}

/**
 * The list you actually tap on the add screen.
 *
 * Ranked by most recent contact across both logging and merely looking: a food
 * you scanned a minute ago is what you are about to reach for, and ranking by
 * frequency alone kept anything new off the list entirely.
 */
export async function recentFoods(
  db: Database,
  userId: string,
  limit: number,
): Promise<FoodRow[]> {
  const rows = await db
    .select({ food: foods })
    .from(foods)
    .innerJoin(
      sql`(
        select food_id, max(at) as last_at from (
          select food_id, created_at as at
            from log_entries where user_id = ${userId}
          union all
          select food_id, viewed_at as at
            from food_views where user_id = ${userId}
        ) touches
        group by food_id
      ) recent`,
      sql`recent.food_id = ${foods.id}`,
    )
    .orderBy(sql`recent.last_at desc`)
    .limit(limit);
  return rows.map((r) => r.food);
}

/**
 * Brands already known to this database, most-used first.
 *
 * Returned whole rather than filtered server-side: the list is small, a
 * datalist filters locally as you type, and one cached request beats a
 * round trip per keystroke on a phone.
 */
export async function knownBrands(db: Database, limit = 200): Promise<string[]> {
  const rows = await db
    .select({ brand: foods.brand, uses: sql<number>`count(*)::int`.as('uses') })
    .from(foods)
    .where(sql`${foods.brand} is not null and length(trim(${foods.brand})) > 0`)
    .groupBy(foods.brand)
    .orderBy(desc(sql`count(*)`), foods.brand)
    .limit(limit);
  return rows.flatMap((r) => (r.brand ? [r.brand] : []));
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
