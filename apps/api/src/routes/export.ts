import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { type AppDeps, requireUser } from '../app.ts';
import { foods, foodServings, goals, logEntries, users, weights } from '../db/schema.ts';

/**
 * Everything this user has put into the app, as one JSON document.
 *
 * Log entries carry the food's name and brand alongside the id: an export you
 * cannot read without re-importing it into this exact schema is not much of an
 * export. Nothing belonging to another user is included, and nothing that
 * cannot be shown to the owner -- no password hash, no session tokens.
 */
export const exportRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  const { db } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/export', async (req, reply) => {
    const user = await requireUser(req);

    const [profile] = await db
      .select({
        email: users.email,
        displayName: users.displayName,
        sex: users.sex,
        birthDate: users.birthDate,
        heightCm: users.heightCm,
        activityLevel: users.activityLevel,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const [goalRows, weightRows, entryRows, customFoods] = await Promise.all([
      db
        .select({
          effectiveFrom: goals.effectiveFrom,
          calories: goals.calories,
          proteinG: goals.proteinG,
          carbsG: goals.carbsG,
          fatG: goals.fatG,
        })
        .from(goals)
        .where(eq(goals.userId, user.id))
        .orderBy(asc(goals.effectiveFrom)),

      db
        .select({ measuredOn: weights.measuredOn, weightKg: weights.weightKg })
        .from(weights)
        .where(eq(weights.userId, user.id))
        .orderBy(asc(weights.measuredOn)),

      db
        .select({
          loggedOn: logEntries.loggedOn,
          meal: logEntries.meal,
          grams: logEntries.grams,
          kcal: logEntries.kcal,
          proteinG: logEntries.proteinG,
          carbsG: logEntries.carbsG,
          fatG: logEntries.fatG,
          loggedAt: logEntries.createdAt,
          foodId: logEntries.foodId,
          foodName: foods.name,
          foodBrand: foods.brand,
        })
        .from(logEntries)
        .innerJoin(foods, eq(foods.id, logEntries.foodId))
        .where(eq(logEntries.userId, user.id))
        .orderBy(asc(logEntries.loggedOn), asc(logEntries.createdAt)),

      db
        .select({
          id: foods.id,
          name: foods.name,
          brand: foods.brand,
          barcode: foods.barcode,
          kcal100g: foods.kcal100g,
          protein100g: foods.protein100g,
          carbs100g: foods.carbs100g,
          fat100g: foods.fat100g,
          createdAt: foods.createdAt,
        })
        .from(foods)
        .where(eq(foods.createdBy, user.id))
        .orderBy(asc(foods.name)),
    ]);

    const servings = customFoods.length
      ? await db
          .select({
            foodId: foodServings.foodId,
            label: foodServings.label,
            grams: foodServings.grams,
          })
          .from(foodServings)
      : [];

    const servingsByFood = new Map<string, { label: string; grams: number }[]>();
    for (const s of servings) {
      const list = servingsByFood.get(s.foodId);
      if (list) list.push({ label: s.label, grams: s.grams });
      else servingsByFood.set(s.foodId, [{ label: s.label, grams: s.grams }]);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    reply.header(
      'content-disposition',
      `attachment; filename="eats-export-${stamp}.json"`,
    );

    return {
      // Bumped if the shape ever changes, so an old file stays readable.
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      profile,
      goals: goalRows,
      weights: weightRows,
      customFoods: customFoods.map((f) => ({
        ...f,
        servings: servingsByFood.get(f.id) ?? [],
      })),
      logEntries: entryRows,
    };
  });
};
