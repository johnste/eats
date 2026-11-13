import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { foods, foodServings, foodViews, logEntries } from '../db/schema.ts';

/**
 * Two foods are the same for this purpose when their names match apart from
 * case and spacing. Nothing else is folded -- accents stay distinct, because
 * merging cannot be undone and two spellings being one word is a guess.
 */
export const normaliseName = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface DuplicateFood {
  id: string;
  name: string;
  brand: string | null;
  source: 'off' | 'custom' | 'slv';
  kcal100g: number;
  estimated: boolean;
  /** How many logged entries point at this food. */
  entries: number;
  /** Only your own foods can be folded away; shared ones can only be kept. */
  removable: boolean;
}

export interface DuplicateGroup {
  name: string;
  foods: DuplicateFood[];
}

/**
 * Foods that share a name, grouped.
 *
 * Scoped the same way search is: your own foods plus the shared Swedish and
 * Open Food Facts entries. A group is only worth showing when at least one of
 * its members is yours -- two Livsmedelsverket foods with the same name are
 * not yours to merge.
 */
export async function findDuplicates(
  db: Database,
  userId: string,
): Promise<DuplicateGroup[]> {
  const rows = await db
    .select({
      id: foods.id,
      name: foods.name,
      brand: foods.brand,
      source: foods.source,
      kcal100g: foods.kcal100g,
      estimated: foods.estimated,
      createdBy: foods.createdBy,
      entries: sql<number>`(
        select count(*)::int from ${logEntries}
        where ${logEntries.foodId} = ${foods.id} and ${logEntries.userId} = ${userId}
      )`,
    })
    .from(foods)
    .where(
      or(eq(foods.source, 'off'), eq(foods.source, 'slv'), eq(foods.createdBy, userId)),
    );

  const byName = new Map<string, DuplicateFood[]>();
  for (const r of rows) {
    const key = normaliseName(r.name);
    const list = byName.get(key) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      brand: r.brand,
      source: r.source,
      kcal100g: r.kcal100g,
      estimated: r.estimated,
      entries: r.entries,
      removable: r.source === 'custom' && r.createdBy === userId,
    });
    byName.set(key, list);
  }

  return (
    [...byName.values()]
      .filter((g) => g.length > 1 && g.some((f) => f.removable))
      // The one you have used most is the likeliest keeper, so it leads.
      .map((g) => ({
        name: (g[0] as DuplicateFood).name,
        foods: [...g].sort((a, b) => b.entries - a.entries),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );
}

export type MergeFailure =
  'same-food' | 'source-missing' | 'target-missing' | 'source-not-yours';

/**
 * Fold one food into another and report how many entries moved.
 *
 * Past days do not change: every log entry carries its own macro snapshot
 * taken when it was logged, so repointing it at another food moves the name
 * it shows and nothing else. That is the whole reason this is safe to offer.
 *
 * Only your own foods can be the one that disappears. Livsmedelsverket and
 * Open Food Facts rows are shared reference data, and deleting one to tidy
 * your own list would take it from everything else that points at it.
 */
export async function mergeFoods(
  db: Database,
  userId: string,
  sourceId: string,
  targetId: string,
): Promise<{ moved: number } | MergeFailure> {
  if (sourceId === targetId) return 'same-food';

  const rows = await db
    .select()
    .from(foods)
    .where(inArray(foods.id, [sourceId, targetId]));
  const source = rows.find((f) => f.id === sourceId);
  const target = rows.find((f) => f.id === targetId);

  if (!source) return 'source-missing';
  if (!target) return 'target-missing';
  if (source.source !== 'custom' || source.createdBy !== userId) {
    return 'source-not-yours';
  }

  return db.transaction(async (tx) => {
    const moved = await tx
      .update(logEntries)
      .set({ foodId: targetId })
      .where(and(eq(logEntries.foodId, sourceId), eq(logEntries.userId, userId)))
      .returning({ id: logEntries.id });

    // Only the owner can have seen their own custom food, so carrying the
    // view across is one row. Views are keyed on (user, food), and the user
    // may already have seen the target, so a conflict is the ordinary case.
    await tx
      .insert(foodViews)
      .values({ userId, foodId: targetId })
      .onConflictDoNothing();

    await tx.delete(foodServings).where(eq(foodServings.foodId, sourceId));
    // food_views rows for the source cascade with the food itself.
    await tx.delete(foods).where(eq(foods.id, sourceId));

    return { moved: moved.length };
  });
}
