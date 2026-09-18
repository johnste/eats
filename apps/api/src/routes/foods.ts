import {
  barcodeLookupResponse,
  createFoodBody,
  errorResponse,
  foodResponse,
  foodSearchQuery,
  foodSearchResponse,
  updateFoodBody,
} from '@eats/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type AppDeps, requireUser } from '../app.ts';
import { foods, foodServings } from '../db/schema.ts';
import {
  findByBarcode,
  insertCustomFood,
  isStale,
  recentFoods,
  searchLocal,
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

      const localRows = await searchLocal(db, user.id, q, limit);
      const local = await withServings(db, localRows);

      // Don't offer a remote result we already hold locally.
      const seen = new Set(local.map((f) => f.barcode).filter(Boolean));

      let offHits: { barcode: string; name: string; brand: string | null }[] = [];
      let offUnavailable = false;
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
    { schema: { response: { 200: z.array(foodResponse) } } },
    async (req) => {
      const user = await requireUser(req);
      return withServings(db, await recentFoods(db, user.id, 30));
    },
  );

  r.get(
    '/barcode/:code',
    {
      schema: {
        params: barcodeParam,
        response: { 200: barcodeLookupResponse, 404: errorResponse, 503: errorResponse },
      },
    },
    async (req, reply) => {
      await requireUser(req);
      const { code } = req.params;

      // Serve from our own table unless the cached copy has aged out.
      const cached = await findByBarcode(db, code);
      if (cached && !isStale(cached.offFetchedAt)) {
        const servings = await db
          .select()
          .from(foodServings)
          .where(eq(foodServings.foodId, cached.id));
        return { status: 'ok' as const, food: toFoodResponse(cached, servings) };
      }

      let product;
      try {
        product = await off.product(code);
      } catch (err) {
        if (!(err instanceof OffUnavailableError)) throw err;
        // A stale local copy beats no answer at all.
        if (cached) {
          const servings = await db
            .select()
            .from(foodServings)
            .where(eq(foodServings.foodId, cached.id));
          return { status: 'ok' as const, food: toFoodResponse(cached, servings) };
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
      return { status: 'ok' as const, food: await upsertOffFood(db, product) };
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
        return toFoodResponse(row, body.servings
          ? await tx.select().from(foodServings).where(eq(foodServings.foodId, row.id))
          : []);
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
