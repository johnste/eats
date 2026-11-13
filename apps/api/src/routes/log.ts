import {
  createLogBatchBody,
  createLogBody,
  dateKey,
  daysBetween,
  daySummaryResponse,
  dayResponse,
  errorResponse,
  logEntryResponse,
  rangeQuery,
  updateLogBody,
} from '@eats/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type AppDeps, requireUser } from '../app.ts';
import { foods, logEntries } from '../db/schema.ts';
import {
  daySummaries,
  entriesForRange,
  goalOn,
  groupByMeal,
  MAX_SUMMARY_DAYS,
  snapshotFor,
  totalsOf,
} from '../lib/log.ts';

const idParam = z.object({ id: z.uuid() });

export const logRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  const { db } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/',
    {
      schema: {
        querystring: z.object({ date: dateKey }),
        response: { 200: dayResponse },
      },
    },
    async (req) => {
      const user = await requireUser(req);
      const { date } = req.query;

      const entries = await entriesForRange(db, user.id, date, date);
      const goal = await goalOn(db, user.id, date);

      return {
        date,
        totals: totalsOf(entries),
        goal: goal
          ? {
              calories: goal.calories,
              proteinG: goal.proteinG,
              carbsG: goal.carbsG,
              fatG: goal.fatG,
            }
          : null,
        meals: groupByMeal(entries),
      };
    },
  );

  r.get(
    '/summary',
    {
      schema: {
        querystring: rangeQuery,
        response: {
          200: z.array(daySummaryResponse),
          400: errorResponse,
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const { from, to } = req.query;
      if (from > to) {
        return reply.status(400).send({ error: '`from` must not be after `to`.' });
      }
      if (daysBetween(from, to) > MAX_SUMMARY_DAYS) {
        return reply
          .status(400)
          .send({ error: `Range is longer than ${MAX_SUMMARY_DAYS} days.` });
      }
      return daySummaries(db, user.id, from, to);
    },
  );

  r.post(
    '/',
    {
      schema: {
        body: createLogBody,
        response: { 200: logEntryResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const { foodId, grams, meal, loggedOn } = req.body;

      const [food] = await db.select().from(foods).where(eq(foods.id, foodId)).limit(1);
      if (!food) return reply.status(404).send({ error: 'No such food.' });

      const macros = snapshotFor(food, grams);
      const [row] = await db
        .insert(logEntries)
        .values({
          userId: user.id,
          foodId: food.id,
          loggedOn,
          meal,
          grams,
          kcal: macros.kcal,
          proteinG: macros.proteinG,
          carbsG: macros.carbsG,
          fatG: macros.fatG,
        })
        .returning();
      if (!row) throw new Error('log insert returned no row');

      return {
        id: row.id,
        meal: row.meal,
        grams: row.grams,
        loggedOn: row.loggedOn,
        kcal: row.kcal,
        proteinG: row.proteinG,
        carbsG: row.carbsG,
        fatG: row.fatG,
        food: {
          id: food.id,
          name: food.name,
          brand: food.brand,
          estimated: food.estimated,
        },
      };
    },
  );

  /**
   * A weighed run -- bread, butter, cheese -- added in one go. All or nothing:
   * half a sandwich on the log is worse than none, because it looks finished.
   */
  r.post(
    '/batch',
    {
      schema: {
        body: createLogBatchBody,
        response: { 200: z.array(logEntryResponse), 404: errorResponse },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const { entries } = req.body;

      const ids = [...new Set(entries.map((e) => e.foodId))];
      const found = await db.select().from(foods).where(inArray(foods.id, ids));
      const byId = new Map(found.map((f) => [f.id, f]));
      if (byId.size !== ids.length) {
        return reply
          .status(404)
          .send({ error: 'One of those foods no longer exists.' });
      }

      const rows = await db
        .insert(logEntries)
        .values(
          entries.map((e) => {
            const food = byId.get(e.foodId)!;
            const macros = snapshotFor(food, e.grams);
            return {
              userId: user.id,
              foodId: food.id,
              loggedOn: e.loggedOn,
              meal: e.meal,
              grams: e.grams,
              kcal: macros.kcal,
              proteinG: macros.proteinG,
              carbsG: macros.carbsG,
              fatG: macros.fatG,
            };
          }),
        )
        .returning();

      return rows.map((row) => {
        const food = byId.get(row.foodId)!;
        return {
          id: row.id,
          meal: row.meal,
          grams: row.grams,
          loggedOn: row.loggedOn,
          kcal: row.kcal,
          proteinG: row.proteinG,
          carbsG: row.carbsG,
          fatG: row.fatG,
          food: {
            id: food.id,
            name: food.name,
            brand: food.brand,
            estimated: food.estimated,
          },
        };
      });
    },
  );

  r.patch(
    '/:id',
    {
      schema: {
        params: idParam,
        body: updateLogBody,
        response: { 200: logEntryResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const [existing] = await db
        .select({ entry: logEntries, food: foods })
        .from(logEntries)
        .innerJoin(foods, eq(foods.id, logEntries.foodId))
        .where(and(eq(logEntries.id, req.params.id), eq(logEntries.userId, user.id)))
        .limit(1);

      if (!existing) return reply.status(404).send({ error: 'No such entry.' });

      const grams = req.body.grams ?? existing.entry.grams;
      const meal = req.body.meal ?? existing.entry.meal;
      const loggedOn = req.body.loggedOn ?? existing.entry.loggedOn;
      // Changing the amount re-snapshots against the food as it is now. That is
      // the one case where a correction upstream can reach an existing entry,
      // and it only happens because the user deliberately edited it.
      const macros = snapshotFor(existing.food, grams);

      const [row] = await db
        .update(logEntries)
        .set({
          grams,
          meal,
          loggedOn,
          kcal: macros.kcal,
          proteinG: macros.proteinG,
          carbsG: macros.carbsG,
          fatG: macros.fatG,
        })
        .where(
          and(eq(logEntries.id, existing.entry.id), eq(logEntries.userId, user.id)),
        )
        .returning();
      if (!row) throw new Error('log update returned no row');

      return {
        id: row.id,
        meal: row.meal,
        grams: row.grams,
        loggedOn: row.loggedOn,
        kcal: row.kcal,
        proteinG: row.proteinG,
        carbsG: row.carbsG,
        fatG: row.fatG,
        food: {
          id: existing.food.id,
          name: existing.food.name,
          brand: existing.food.brand,
          estimated: existing.food.estimated,
        },
      };
    },
  );

  r.delete(
    '/:id',
    {
      schema: {
        params: idParam,
        response: { 200: z.object({ ok: z.boolean() }), 404: errorResponse },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const deleted = await db
        .delete(logEntries)
        .where(and(eq(logEntries.id, req.params.id), eq(logEntries.userId, user.id)))
        .returning({ id: logEntries.id });
      if (deleted.length === 0) {
        return reply.status(404).send({ error: 'No such entry.' });
      }
      return { ok: true };
    },
  );
};
