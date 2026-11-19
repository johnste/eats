import type { FoodResponse, Meal } from '@eats/shared';
import { and, desc, eq, gt, ilike, inArray, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Executor } from '../db/client.ts';
import { foods, foodServings, foodViews, logEntries, users } from '../db/schema.ts';
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
    estimated: food.estimated,
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

/** Entries per food that count towards its usual amount. */
const USUAL_FROM_LAST = 10;

/**
 * How much of each food this user usually logs: the median of their last few
 * entries. The median, because one double portion should not drag the answer
 * up, and only the last few, because what you eat changes.
 */
export async function usualGrams(
  db: Database,
  userId: string,
  foodIds: string[],
): Promise<Map<string, number>> {
  if (foodIds.length === 0) return new Map();
  const latest = db
    .select({
      foodId: logEntries.foodId,
      grams: logEntries.grams,
      n: sql<number>`row_number() over (
        partition by ${logEntries.foodId} order by ${logEntries.createdAt} desc
      )`.as('n'),
    })
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), inArray(logEntries.foodId, foodIds)))
    .as('latest');

  const rows = await db
    .select({
      foodId: latest.foodId,
      usual: sql<number>`percentile_cont(0.5) within group (order by ${latest.grams})`,
    })
    .from(latest)
    .where(sql`${latest.n} <= ${USUAL_FROM_LAST}`)
    .groupBy(latest.foodId);
  return new Map(rows.map((r) => [r.foodId, Math.round(Number(r.usual))]));
}

/**
 * Every food this user has added, with how often it is on their log and
 * when it last was -- the Foods tab, where they are looked after.
 */
export async function myFoods(db: Database, userId: string) {
  const rows = await db
    .select({
      food: foods,
      // Spelled out with table names: inside a hand-written subquery Drizzle
      // renders column references unqualified, and "id" then resolves to the
      // log entry's own id -- every count came back 0.
      entries: sql<number>`(
        select count(*)::int from log_entries le
        where le.food_id = foods.id and le.user_id = ${userId}
      )`,
      lastLoggedOn: sql<string | null>`(
        select max(le.logged_on)::text from log_entries le
        where le.food_id = foods.id and le.user_id = ${userId}
      )`,
    })
    .from(foods)
    .where(and(eq(foods.source, 'custom'), eq(foods.createdBy, userId)))
    .orderBy(sql`lower(${foods.name})`);
  const withS = await withServings(
    db,
    rows.map((r) => r.food),
  );
  return withS.map((f, i) => ({
    ...f,
    entries: rows[i]!.entries,
    lastLoggedOn: rows[i]!.lastLoggedOn,
  }));
}

/** Servings and usual amounts together: what a list you pick from needs. */
export async function forPicking(
  db: Database,
  userId: string,
  rows: FoodRow[],
): Promise<FoodResponse[]> {
  const [withS, usual] = await Promise.all([
    withServings(db, rows),
    usualGrams(
      db,
      userId,
      rows.map((r) => r.id),
    ),
  ]);
  return withS.map((f) => ({ ...f, usualGrams: usual.get(f.id) ?? null }));
}

/**
 * Foods you have eaten in the same meal as any of these, most often first.
 *
 * A meal is a (day, meal) pair, and each one counts once however many of the
 * given foods were in it -- bread and butter on the same plate is one
 * sandwich, not two votes for the cheese that was also on it.
 */
export async function companionFoods(
  db: Database,
  userId: string,
  foodIds: string[],
  limit = 8,
): Promise<FoodRow[]> {
  const mine = alias(logEntries, 'mine');
  const other = alias(logEntries, 'other');
  const meals = sql<number>`count(distinct (${other.loggedOn}, ${other.meal}))`;

  const ranked = await db
    .select({ foodId: other.foodId })
    .from(mine)
    .innerJoin(
      other,
      and(
        eq(other.userId, mine.userId),
        eq(other.loggedOn, mine.loggedOn),
        eq(other.meal, mine.meal),
      ),
    )
    .where(
      and(
        eq(mine.userId, userId),
        inArray(mine.foodId, foodIds),
        notInArray(other.foodId, foodIds),
      ),
    )
    .groupBy(other.foodId)
    .orderBy(desc(meals), desc(sql`max(${other.createdAt})`))
    .limit(limit);
  if (ranked.length === 0) return [];

  const rows = await db
    .select()
    .from(foods)
    .where(
      inArray(
        foods.id,
        ranked.map((r) => r.foodId),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ranked.flatMap((r) => byId.get(r.foodId) ?? []);
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
 * Which shared sources this user wants consulted. Your own foods are always
 * searched -- they are yours, and there is nothing external about them.
 */
export interface FoodSources {
  /** Open Food Facts in search. */
  useOff: boolean;
  /** Open Food Facts for barcode scans. */
  useOffBarcode: boolean;
  useSlv: boolean;
}

export async function foodSources(db: Database, userId: string): Promise<FoodSources> {
  const [row] = await db
    .select({
      useOff: users.useOff,
      useOffBarcode: users.useOffBarcode,
      useSlv: users.useSlv,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // A missing row cannot happen behind requireUser, but defaulting to on
  // matches what a new account gets.
  return {
    useOff: row?.useOff ?? true,
    useOffBarcode: row?.useOffBarcode ?? true,
    useSlv: row?.useSlv ?? true,
  };
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
 *
 * `sources` drops the shared shelves the user has switched off in settings.
 * It defaults to both on so callers that have no user context -- and tests --
 * keep seeing everything.
 */
export async function searchLocal(
  db: Database,
  userId: string,
  query: string,
  limit: number,
  sources: Pick<FoodSources, 'useOff' | 'useSlv'> = { useOff: true, useSlv: true },
): Promise<FoodRow[]> {
  const pattern = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  return db
    .select()
    .from(foods)
    .where(
      and(
        or(ilike(foods.name, pattern), ilike(foods.brand, pattern)),
        // Your own foods always, plus whichever shared sources are switched
        // on. `or` needs at least one arm, and your own foods are it.
        or(
          eq(foods.createdBy, userId),
          // With Open Food Facts out of search, products you have scanned or
          // logged still come up by name: the scanner may be on, and a
          // yoghurt scanned yesterday should not need scanning again to be
          // found. Table names spelled out, as Drizzle leaves hand-written
          // column references unqualified.
          sources.useOff
            ? eq(foods.source, 'off')
            : and(
                eq(foods.source, 'off'),
                sql`(
                  exists (select 1 from food_views fv
                          where fv.food_id = foods.id and fv.user_id = ${userId})
                  or exists (select 1 from log_entries le
                             where le.food_id = foods.id and le.user_id = ${userId})
                )`,
              ),
          ...(sources.useSlv ? [eq(foods.source, 'slv')] : []),
        ),
        // Shared rows with nothing in them are not worth offering: they are
        // what Open Food Facts gives us for a product nobody has filled in,
        // and picking one logs four zeros. Your own foods are exempt -- if you
        // entered zeros you meant them.
        or(
          eq(foods.createdBy, userId),
          gt(foods.kcal100g, 0),
          gt(foods.protein100g, 0),
          gt(foods.carbs100g, 0),
          gt(foods.fat100g, 0),
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
  meal?: Meal,
): Promise<FoodRow[]> {
  // When a meal is named, what you reach for at breakfast is almost never
  // what you reach for at dinner, so anything you have logged to that meal
  // sorts above everything else -- each group still in recency order.
  const inMeal = meal ? sql`meal = ${meal}` : sql`false`;

  const rows = await db
    .select({ food: foods })
    .from(foods)
    .innerJoin(
      sql`(
        select
          food_id,
          max(at) as last_at,
          max(at) filter (where in_meal) as last_meal_at
        from (
          select food_id, created_at as at, ${inMeal} as in_meal
            from log_entries where user_id = ${userId}
          union all
          select food_id, viewed_at as at, false
            from food_views where user_id = ${userId}
        ) touches
        group by food_id
      ) recent`,
      sql`recent.food_id = ${foods.id}`,
    )
    // nulls last is not the default for desc in Postgres, and without it
    // every food you have never logged to this meal would sort to the top.
    .orderBy(sql`recent.last_meal_at desc nulls last, recent.last_at desc`)
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

/**
 * Add portions to a food, or correct ones it has. A portion whose label
 * matches an existing one (ignoring case and surrounding space) changes that
 * portion's weight instead of adding a second "1 slice" beside it; any other
 * label is added. Nothing is removed. Returns the food's portions afterwards,
 * read the same way the app reads them.
 */
export async function setPortions(
  db: Database,
  foodId: string,
  portions: { label: string; grams: number }[],
): Promise<ServingRow[]> {
  const key = (label: string) => label.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(foodServings)
      .where(eq(foodServings.foodId, foodId));
    const byLabel = new Map(existing.map((s) => [key(s.label), s]));

    for (const p of portions) {
      const label = p.label.trim();
      const match = byLabel.get(key(label));
      if (match) {
        if (match.grams !== p.grams) {
          await tx
            .update(foodServings)
            .set({ grams: p.grams })
            .where(eq(foodServings.id, match.id));
        }
      } else {
        const [row] = await tx
          .insert(foodServings)
          .values({ foodId, label, grams: p.grams })
          .returning();
        // A second portion of the same label in one call updates the first.
        if (row) byLabel.set(key(label), row);
      }
    }

    return tx.select().from(foodServings).where(eq(foodServings.foodId, foodId));
  });
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
    estimated?: boolean | undefined;
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
      estimated: input.estimated ?? false,
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
