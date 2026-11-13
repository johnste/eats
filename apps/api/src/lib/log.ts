import { addDays, scaleMacros, sumMacros, type Macros, type Meal } from '@eats/shared';
import { and, asc, between, desc, eq, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { foods, goals, logEntries } from '../db/schema.ts';

type FoodRow = typeof foods.$inferSelect;

export const per100gOf = (food: FoodRow): Macros => ({
  kcal: food.kcal100g,
  proteinG: food.protein100g,
  carbsG: food.carbs100g,
  fatG: food.fat100g,
});

/**
 * The macros an entry gets frozen with. Computed once, at log time, from the
 * food as it exists right then -- later corrections upstream never reach back
 * into a day you have already logged.
 */
export const snapshotFor = (food: FoodRow, grams: number): Macros =>
  scaleMacros(per100gOf(food), grams);

/**
 * The goal in force on a given day: the most recent row whose effective_from
 * is on or before it. Returns null before the first goal was ever set.
 */
export async function goalOn(db: Database, userId: string, date: string) {
  const [row] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), lte(goals.effectiveFrom, date)))
    .orderBy(desc(goals.effectiveFrom))
    .limit(1);
  return row ?? null;
}

export interface DayEntry extends Macros {
  id: string;
  meal: Meal;
  grams: number;
  loggedOn: string;
  food: { id: string; name: string; brand: string | null; estimated: boolean };
}

export async function entriesForRange(
  db: Database,
  userId: string,
  from: string,
  to: string,
): Promise<DayEntry[]> {
  const rows = await db
    .select({ entry: logEntries, food: foods })
    .from(logEntries)
    .innerJoin(foods, eq(foods.id, logEntries.foodId))
    .where(and(eq(logEntries.userId, userId), between(logEntries.loggedOn, from, to)))
    .orderBy(asc(logEntries.loggedOn), asc(logEntries.createdAt));

  return rows.map(({ entry, food }) => ({
    id: entry.id,
    meal: entry.meal,
    grams: entry.grams,
    loggedOn: entry.loggedOn,
    kcal: entry.kcal,
    proteinG: entry.proteinG,
    carbsG: entry.carbsG,
    fatG: entry.fatG,
    food: {
      id: food.id,
      name: food.name,
      brand: food.brand,
      estimated: food.estimated,
    },
  }));
}

export const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/** Always emit every meal, so the day view has stable sections to render. */
export function groupByMeal(entries: DayEntry[]): Record<Meal, DayEntry[]> {
  const out = Object.fromEntries(
    MEAL_ORDER.map((m) => [m, [] as DayEntry[]]),
  ) as Record<Meal, DayEntry[]>;
  for (const e of entries) out[e.meal].push(e);
  return out;
}

/**
 * Totals are summed from the stored snapshots rather than recomputed from
 * grams, so the figure at the top of the day always equals the sum of the
 * numbers listed beneath it.
 */
export const totalsOf = (entries: DayEntry[]): Macros => sumMacros(entries);

/** Per-day totals across a range, for the history view. */
export async function dailyTotals(
  db: Database,
  userId: string,
  from: string,
  to: string,
) {
  return db
    .select({
      date: logEntries.loggedOn,
      kcal: sql<number>`sum(${logEntries.kcal})::real`,
      proteinG: sql<number>`sum(${logEntries.proteinG})::real`,
      carbsG: sql<number>`sum(${logEntries.carbsG})::real`,
      fatG: sql<number>`sum(${logEntries.fatG})::real`,
    })
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), between(logEntries.loggedOn, from, to)))
    .groupBy(logEntries.loggedOn)
    .orderBy(asc(logEntries.loggedOn));
}

/** A year is plenty to chart, and keeps one request from scanning a lifetime. */
export const MAX_SUMMARY_DAYS = 366;

/**
 * Per-day totals across a range, with every day present and the goal that
 * applied on it.
 *
 * `dailyTotals` only returns days that have entries, which is right for a sum
 * and wrong for a chart: a missing day would close the gap and draw a line
 * straight over a day you never logged. Here the gaps are kept as nulls.
 */
export async function daySummaries(
  db: Database,
  userId: string,
  from: string,
  to: string,
) {
  const logged = await dailyTotals(db, userId, from, to);
  const byDate = new Map(logged.map((row) => [row.date, row]));

  // Every goal that could apply, oldest first, walked alongside the dates.
  const history = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), lte(goals.effectiveFrom, to)))
    .orderBy(asc(goals.effectiveFrom));

  const out = [];
  let g = -1;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    while (
      g + 1 < history.length &&
      (history[g + 1] as (typeof history)[number]).effectiveFrom <= date
    ) {
      g++;
    }
    const applicable = g >= 0 ? (history[g] as (typeof history)[number]) : null;
    const row = byDate.get(date);
    out.push({
      date,
      kcal: row?.kcal ?? null,
      proteinG: row?.proteinG ?? null,
      carbsG: row?.carbsG ?? null,
      fatG: row?.fatG ?? null,
      goal: applicable
        ? {
            calories: applicable.calories,
            proteinG: applicable.proteinG,
            carbsG: applicable.carbsG,
            fatG: applicable.fatG,
          }
        : null,
    });
  }
  return out;
}
