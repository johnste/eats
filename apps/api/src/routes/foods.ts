import {
  barcodeLookupResponse,
  companionsQuery,
  myFoodResponse,
  createFoodBody,
  errorResponse,
  foodResponse,
  foodSearchQuery,
  duplicateGroupResponse,
  foodSearchResponse,
  hasNutrition,
  mealSchema,
  mergeFoodsBody,
  suggestQuery,
  suggestResponse,
  updateFoodBody,
} from '@eats/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type AppDeps, requireUser } from '../app.ts';
import { findDuplicates, mergeFoods, type MergeFailure } from '../lib/dedupe.ts';

/** One sentence per way a merge can be refused, said the same way everywhere. */
const MERGE_ERRORS: Record<MergeFailure, [400 | 404, string]> = {
  'same-food': [400, 'A food cannot be merged into itself.'],
  'source-missing': [404, 'No such food to merge away.'],
  'target-missing': [404, 'No such food to merge into.'],
  'source-not-yours': [
    400,
    'Only a food you added can be merged away. Shared entries from ' +
      'Livsmedelsverket and Open Food Facts can be kept, not removed.',
  ],
};
import { foods, foodServings, logEntries } from '../db/schema.ts';
import {
  findByBarcode,
  companionFoods,
  foodSources,
  forPicking,
  myFoods,
  insertCustomFood,
  isStale,
  knownBrands,
  recentFoods,
  recordFoodView,
  searchLocal,
  suggestionStats,
  toFoodResponse,
  upsertOffFood,
  withServings,
} from '../lib/foods.ts';
import { OffUnavailableError } from '../lib/off.ts';

const barcodeParam = z.object({ code: z.string().regex(/^\d{6,14}$/) });
const idParam = z.object({ id: z.uuid() });

export const foodRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  const { db, off } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/search',
    { schema: { querystring: foodSearchQuery, response: { 200: foodSearchResponse } } },
    async (req) => {
      const user = await requireUser(req);
      const { q, limit } = req.query;

      const sources = await foodSources(db, user.id);
      const localRows = await searchLocal(db, user.id, q, limit, sources);
      const local = await forPicking(db, user.id, localRows);

      // Don't offer a remote result we already hold locally.
      const seen = new Set(local.map((f) => f.barcode).filter(Boolean));

      let offHits: { barcode: string; name: string; brand: string | null }[] = [];
      let offUnavailable = false;
      // Switched off means not asked, not asked-and-ignored: no request
      // leaves the server at all.
      if (!sources.useOff) return { local, off: offHits, offUnavailable };
      try {
        offHits = (await off.search(q, limit)).filter((c) => !seen.has(c.barcode));
      } catch (err) {
        // Losing Open Food Facts must not take local search down with it.
        if (!(err instanceof OffUnavailableError)) throw err;
        offUnavailable = true;
        req.log.warn({ err }, 'open food facts search unavailable');
      }

      return { local, off: offHits, offUnavailable };
    },
  );

  r.get(
    '/recent',
    {
      schema: {
        querystring: z.object({ meal: mealSchema.optional() }),
        response: { 200: z.array(foodResponse) },
      },
    },
    async (req) => {
      const user = await requireUser(req);
      return forPicking(
        db,
        user.id,
        await recentFoods(db, user.id, 30, req.query.meal),
      );
    },
  );

  r.get(
    '/mine',
    { schema: { response: { 200: z.array(myFoodResponse) } } },
    async (req) => {
      const user = await requireUser(req);
      return myFoods(db, user.id);
    },
  );

  /**
   * Only your own foods, and only ones nothing on your log points at. A
   * food that has been eaten is part of the record; to be rid of one, it is
   * merged into the food it duplicates, which moves its entries across.
   */
  r.delete(
    '/:id',
    {
      schema: {
        params: idParam,
        response: {
          200: z.object({ ok: z.literal(true) }),
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const [food] = await db
        .select()
        .from(foods)
        .where(eq(foods.id, req.params.id))
        .limit(1);
      if (!food) return reply.status(404).send({ error: 'No such food.' });
      if (food.source !== 'custom' || food.createdBy !== user.id) {
        return reply
          .status(403)
          .send({ error: 'Only a food you added can be deleted.' });
      }
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(logEntries)
        .where(eq(logEntries.foodId, food.id));
      if (n > 0) {
        return reply.status(409).send({
          error:
            `It is on your log ${n === 1 ? 'once' : `${n} times`}, so it stays. ` +
            'If it duplicates another food, merge it into that one under Duplicate foods.',
        });
      }
      await db.delete(foods).where(eq(foods.id, food.id));
      return { ok: true as const };
    },
  );

  r.get(
    '/companions',
    {
      schema: {
        querystring: companionsQuery,
        response: { 200: z.array(foodResponse) },
      },
    },
    async (req) => {
      const user = await requireUser(req);
      return forPicking(db, user.id, await companionFoods(db, user.id, req.query.ids));
    },
  );

  r.get(
    '/suggest',
    {
      schema: {
        querystring: suggestQuery,
        response: { 200: suggestResponse },
      },
    },
    async (req) => {
      const user = await requireUser(req);
      const { meal, date, with: picked } = req.query;
      const stats = await suggestionStats(db, user.id, meal, date, picked);
      const ids = stats.foods.map((f) => f.id);
      const rows = ids.length
        ? await db.select().from(foods).where(inArray(foods.id, ids))
        : [];
      const picking = new Map(
        (await forPicking(db, user.id, rows)).map((f) => [f.id, f]),
      );
      return {
        ...stats,
        foods: stats.foods.flatMap((s) => {
          const food = picking.get(s.id);
          return food ? [{ ...food, ...s }] : [];
        }),
      };
    },
  );

  r.get(
    '/duplicates',
    { schema: { response: { 200: z.array(duplicateGroupResponse) } } },
    async (req) => {
      const user = await requireUser(req);
      return findDuplicates(db, user.id);
    },
  );

  r.post(
    '/merge',
    {
      schema: {
        body: mergeFoodsBody,
        response: {
          200: z.object({ moved: z.number() }),
          400: errorResponse,
          404: errorResponse,
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const result = await mergeFoods(
        db,
        user.id,
        req.body.sourceId,
        req.body.targetId,
      );
      if (typeof result === 'string') {
        const [status, message] = MERGE_ERRORS[result];
        return reply.status(status).send({ error: message });
      }
      return result;
    },
  );

  r.get(
    '/brands',
    { schema: { response: { 200: z.array(z.string()) } } },
    async (req) => {
      await requireUser(req);
      return knownBrands(db);
    },
  );

  r.get(
    '/barcode/:code',
    {
      schema: {
        params: barcodeParam,
        response: {
          200: barcodeLookupResponse,
          404: errorResponse,
          503: errorResponse,
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const { code } = req.params;

      // Every path that answers from our own table answers the same way.
      type Cached = NonNullable<Awaited<ReturnType<typeof findByBarcode>>>;
      const serveCached = async (food: Cached) => {
        const servings = await db
          .select()
          .from(foodServings)
          .where(eq(foodServings.foodId, food.id));
        await recordFoodView(db, user.id, food.id);
        return { status: 'ok' as const, food: toFoodResponse(food, servings) };
      };

      // Serve from our own table unless the cached copy has aged out -- or
      // has nothing in it. A row of zeros is what we stored the last time Open
      // Food Facts had no nutrition for this barcode; somebody may have filled
      // it in since, and if not we are no worse off asking.
      const cached = await findByBarcode(db, code);
      const usableCache = cached && hasNutrition(cached) ? cached : null;
      if (usableCache && !isStale(usableCache.offFetchedAt)) {
        return serveCached(usableCache);
      }

      // With Open Food Facts switched off a barcode can still match something
      // already in the table -- including a copy that has aged out, since a
      // stale local answer beats refusing one. Beyond that there is nowhere
      // to look, so offer manual entry with the barcode attached.
      if (!(await foodSources(db, user.id)).useOffBarcode) {
        if (usableCache) {
          return serveCached(usableCache);
        }
        return {
          status: 'incomplete' as const,
          prefill: {
            barcode: code,
            name: '',
            brand: null,
            servingG: null,
            // A marker the form recognises, not a field that is missing:
            // nothing was asked, so nothing is known to be missing.
            missing: ['lookup switched off'],
          },
        };
      }

      let product;
      try {
        product = await off.product(code);
      } catch (err) {
        if (!(err instanceof OffUnavailableError)) throw err;
        // A stale local copy beats no answer at all -- an empty one does not.
        if (usableCache) {
          return serveCached(usableCache);
        }
        return reply.status(503).send({ error: err.message });
      }

      if (product.status === 'not_found') {
        return reply.status(404).send({ error: 'No product with that barcode.' });
      }
      if (product.status === 'incomplete') {
        return {
          status: 'incomplete' as const,
          prefill: {
            barcode: product.barcode,
            name: product.name,
            brand: product.brand,
            servingG: product.servingG,
            missing: product.missing,
          },
        };
      }
      const food = await upsertOffFood(db, product);
      await recordFoodView(db, user.id, food.id);
      return { status: 'ok' as const, food };
    },
  );

  r.get(
    '/:id',
    {
      schema: {
        params: idParam,
        response: { 200: foodResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      await requireUser(req);
      const [row] = await db
        .select()
        .from(foods)
        .where(eq(foods.id, req.params.id))
        .limit(1);
      if (!row) return reply.status(404).send({ error: 'No such food.' });

      const servings = await db
        .select()
        .from(foodServings)
        .where(eq(foodServings.foodId, row.id));
      return toFoodResponse(row, servings);
    },
  );

  r.post(
    '/',
    { schema: { body: createFoodBody, response: { 200: foodResponse } } },
    async (req) => {
      const user = await requireUser(req);
      const body = req.body;
      return db.transaction(async (tx) => {
        const row = await insertCustomFood(tx, user.id, body);
        await recordFoodView(tx, user.id, row.id);
        return toFoodResponse(
          row,
          body.servings
            ? await tx
                .select()
                .from(foodServings)
                .where(eq(foodServings.foodId, row.id))
            : [],
        );
      });
    },
  );

  r.patch(
    '/:id',
    {
      schema: {
        params: idParam,
        body: updateFoodBody,
        response: { 200: foodResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const [existing] = await db
        .select()
        .from(foods)
        .where(eq(foods.id, req.params.id))
        .limit(1);

      if (!existing) return reply.status(404).send({ error: 'No such food.' });
      // Cached OFF products are shared between users; only custom foods are
      // editable, and only by whoever created them.
      if (existing.source !== 'custom' || existing.createdBy !== user.id) {
        return reply.status(403).send({ error: 'That food cannot be edited.' });
      }

      const { servings, ...fields } = req.body;
      const updates = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      );

      return db.transaction(async (tx) => {
        const [row] = Object.keys(updates).length
          ? await tx
              .update(foods)
              .set(updates)
              .where(and(eq(foods.id, existing.id), eq(foods.createdBy, user.id)))
              .returning()
          : [existing];
        if (!row) throw new Error('food update returned no row');

        if (servings) {
          await tx.delete(foodServings).where(eq(foodServings.foodId, row.id));
          if (servings.length > 0) {
            await tx
              .insert(foodServings)
              .values(servings.map((s) => ({ foodId: row.id, ...s })));
          }
        }
        const current = await tx
          .select()
          .from(foodServings)
          .where(eq(foodServings.foodId, row.id));
        return toFoodResponse(row, current);
      });
    },
  );
};
