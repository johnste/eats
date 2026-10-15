import {
  activityLevelSchema,
  ageFrom,
  bmr,
  createWeightBody,
  dateKey,
  errorResponse,
  goalBody,
  profileBody,
  rangeQuery,
  sexSchema,
  suggestMacroSplit,
  targetCalories,
  tdee,
  toDateKey,
  WEIGHT_GOALS,
} from '@eats/shared';
import { and, asc, between, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type AppDeps, requireUser } from '../app.ts';
import { goals, users, weights } from '../db/schema.ts';
import { goalOn } from '../lib/log.ts';
import { listGrants, revokeGrant } from '../lib/oauth.ts';
import {
  createToken,
  generatePassphrase,
  listTokens,
  revokeToken,
  secretProblem,
} from '../lib/tokens.ts';

const goalShape = z.object({
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  effectiveFrom: dateKey,
});

const profileShape = z.object({
  sex: sexSchema.nullable(),
  birthDate: dateKey.nullable(),
  heightCm: z.number().nullable(),
  activityLevel: activityLevelSchema.nullable(),
  targetWeightKg: z.number().nullable(),
  useOff: z.boolean(),
  useSlv: z.boolean(),
});

const weightShape = z.object({ measuredOn: dateKey, weightKg: z.number() });

export const meRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  const { db } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  /* ----------------------------------------------------------- profile --- */

  r.get('/profile', { schema: { response: { 200: profileShape } } }, async (req) => {
    const user = await requireUser(req);
    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!row) throw new Error('session user missing from users table');
    return {
      sex: row.sex,
      birthDate: row.birthDate,
      heightCm: row.heightCm,
      activityLevel: row.activityLevel,
      targetWeightKg: row.targetWeightKg,
      useOff: row.useOff,
      useSlv: row.useSlv,
    };
  });

  r.put(
    '/profile',
    { schema: { body: profileBody, response: { 200: profileShape } } },
    async (req) => {
      const user = await requireUser(req);
      const [row] = await db
        .update(users)
        .set(req.body)
        .where(eq(users.id, user.id))
        .returning();
      if (!row) throw new Error('profile update returned no row');
      return {
        sex: row.sex,
        birthDate: row.birthDate,
        heightCm: row.heightCm,
        activityLevel: row.activityLevel,
        targetWeightKg: row.targetWeightKg,
        useOff: row.useOff,
        useSlv: row.useSlv,
      };
    },
  );

  /* ------------------------------------------------------------- goals --- */

  r.get(
    '/goals',
    { schema: { response: { 200: goalShape.nullable() } } },
    async (req) => {
      const user = await requireUser(req);
      const row = await goalOn(db, user.id, toDateKey());
      return row
        ? {
            calories: row.calories,
            proteinG: row.proteinG,
            carbsG: row.carbsG,
            fatG: row.fatG,
            effectiveFrom: row.effectiveFrom,
          }
        : null;
    },
  );

  r.put(
    '/goals',
    { schema: { body: goalBody, response: { 200: goalShape } } },
    async (req) => {
      const user = await requireUser(req);
      const effectiveFrom = req.body.effectiveFrom ?? toDateKey();
      const values = {
        userId: user.id,
        effectiveFrom,
        calories: req.body.calories,
        proteinG: req.body.proteinG,
        carbsG: req.body.carbsG,
        fatG: req.body.fatG,
      };

      // Goals are append-only by date, but setting one twice in a day is an
      // edit of today's target, not a second historical row.
      const [row] = await db
        .insert(goals)
        .values(values)
        .onConflictDoUpdate({
          target: [goals.userId, goals.effectiveFrom],
          set: {
            calories: values.calories,
            proteinG: values.proteinG,
            carbsG: values.carbsG,
            fatG: values.fatG,
          },
        })
        .returning();
      if (!row) throw new Error('goal upsert returned no row');
      return {
        calories: row.calories,
        proteinG: row.proteinG,
        carbsG: row.carbsG,
        fatG: row.fatG,
        effectiveFrom: row.effectiveFrom,
      };
    },
  );

  /* -------------------------------------------------------------- tdee --- */

  r.get(
    '/tdee',
    {
      schema: {
        // Goal and rate are query parameters rather than stored settings: this
        // endpoint only ever advises, and what it advises should change as you
        // move the controls without writing anything down.
        querystring: z.object({
          goal: z.enum(WEIGHT_GOALS).default('maintain'),
          kgPerWeek: z.coerce.number().min(0).max(1).default(0.5),
        }),
        response: {
          200: z.object({
            tdee: z.number(),
            bmr: z.number(),
            weightKg: z.number(),
            /** What to eat for the requested goal. */
            calories: z.number(),
            dailyDelta: z.number(),
            /** True when the rate was clamped to keep intake above resting. */
            limited: z.boolean(),
            suggested: z.object({
              proteinG: z.number(),
              carbsG: z.number(),
              fatG: z.number(),
            }),
          }),
          409: errorResponse,
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const [profile] = await db
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      const [latestWeight] = await db
        .select()
        .from(weights)
        .where(eq(weights.userId, user.id))
        .orderBy(desc(weights.measuredOn))
        .limit(1);

      // Every input is required; guessing any of them would produce a number
      // that looks authoritative and isn't.
      const missing: string[] = [];
      if (!profile?.sex) missing.push('sex');
      if (!profile?.birthDate) missing.push('date of birth');
      if (!profile?.heightCm) missing.push('height');
      if (!profile?.activityLevel) missing.push('activity level');
      if (!latestWeight) missing.push('a weight entry');
      if (missing.length > 0 || !profile || !latestWeight) {
        return reply.status(409).send({
          error: `Add ${missing.join(', ')} to estimate your daily energy use.`,
        });
      }

      const body = {
        sex: profile.sex!,
        weightKg: latestWeight.weightKg,
        heightCm: profile.heightCm!,
        ageYears: ageFrom(profile.birthDate!),
      };
      const maintenance = tdee({
        ...body,
        activityLevel: profile.activityLevel!,
      });
      const resting = bmr(body);

      const { goal, kgPerWeek } = req.query;
      const target = targetCalories({
        tdee: maintenance,
        goal,
        kgPerWeek,
        bmr: resting,
      });

      return {
        tdee: maintenance,
        bmr: resting,
        weightKg: latestWeight.weightKg,
        calories: target.calories,
        dailyDelta: target.dailyDelta,
        limited: target.limited,
        suggested: suggestMacroSplit({
          calories: target.calories,
          weightKg: latestWeight.weightKg,
          goal,
        }),
      };
    },
  );

  /* ------------------------------------------------------ agent tokens --- */

  const tokenShape = z.object({
    id: z.string(),
    name: z.string(),
    hint: z.string(),
    lastUsedAt: z.string().nullable(),
    createdAt: z.string(),
  });

  r.get(
    '/tokens',
    { schema: { response: { 200: z.array(tokenShape) } } },
    async (req) => {
      const user = await requireUser(req);
      const rows = await listTokens(db, user.id);
      return rows.map((t) => ({
        id: t.id,
        name: t.name,
        hint: t.hint,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }));
    },
  );

  // A phrase to hand to an agent, for when you would rather not think one up.
  r.get(
    '/tokens/suggestion',
    { schema: { response: { 200: z.object({ secret: z.string() }) } } },
    async (req) => {
      await requireUser(req);
      return { secret: generatePassphrase() };
    },
  );

  r.post(
    '/tokens',
    {
      schema: {
        body: z.object({
          name: z.string().min(1).max(60),
          secret: z.string().min(1).max(200),
        }),
        response: {
          200: z.object({ id: z.string(), secret: z.string() }),
          400: errorResponse,
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const secret = req.body.secret.trim();
      const problem = secretProblem(secret);
      if (problem) return reply.status(400).send({ error: problem });

      const { id } = await createToken(db, user.id, req.body.name.trim(), secret);
      // Echoed back so the UI can show what was saved; the phrase itself is
      // the user's to keep, and only its argon2 digest is stored.
      return { id, secret };
    },
  );

  /* --------------------------------------------------- connected apps --- */

  const grantShape = z.object({
    clientId: z.string(),
    clientName: z.string(),
    connectedAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
  });

  r.get(
    '/connections',
    { schema: { response: { 200: z.array(grantShape) } } },
    async (req) => {
      const user = await requireUser(req);
      const rows = await listGrants(db, user.id);
      return rows.map((g) => ({
        clientId: g.clientId,
        clientName: g.clientName,
        connectedAt: g.connectedAt?.toISOString() ?? null,
        lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
      }));
    },
  );

  r.delete(
    '/connections/:clientId',
    {
      schema: {
        params: z.object({ clientId: z.uuid() }),
        response: { 200: z.object({ ok: z.boolean() }), 404: errorResponse },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const revoked = await revokeGrant(db, user.id, req.params.clientId);
      if (revoked === 0) {
        return reply.status(404).send({ error: 'Not connected.' });
      }
      return { ok: true };
    },
  );

  r.delete(
    '/tokens/:id',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ ok: z.boolean() }), 404: errorResponse },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const revoked = await revokeToken(db, user.id, req.params.id);
      if (revoked.length === 0) {
        return reply.status(404).send({ error: 'No such token.' });
      }
      return { ok: true };
    },
  );

  /* ----------------------------------------------------------- weights --- */

  r.get(
    '/weights',
    {
      schema: {
        querystring: rangeQuery,
        response: { 200: z.array(weightShape) },
      },
    },
    async (req) => {
      const user = await requireUser(req);
      return db
        .select({ measuredOn: weights.measuredOn, weightKg: weights.weightKg })
        .from(weights)
        .where(
          and(
            eq(weights.userId, user.id),
            between(weights.measuredOn, req.query.from, req.query.to),
          ),
        )
        .orderBy(asc(weights.measuredOn));
    },
  );

  r.post(
    '/weights',
    { schema: { body: createWeightBody, response: { 200: weightShape } } },
    async (req) => {
      const user = await requireUser(req);
      // One weight per day: logging again replaces it rather than stacking up.
      const [row] = await db
        .insert(weights)
        .values({ userId: user.id, ...req.body })
        .onConflictDoUpdate({
          target: [weights.userId, weights.measuredOn],
          set: { weightKg: req.body.weightKg },
        })
        .returning();
      if (!row) throw new Error('weight upsert returned no row');
      return { measuredOn: row.measuredOn, weightKg: row.weightKg };
    },
  );

  r.delete(
    '/weights/:date',
    {
      schema: {
        params: z.object({ date: dateKey }),
        response: { 200: z.object({ ok: z.boolean() }), 404: errorResponse },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req);
      const deleted = await db
        .delete(weights)
        .where(
          and(eq(weights.userId, user.id), eq(weights.measuredOn, req.params.date)),
        )
        .returning({ id: weights.id });
      if (deleted.length === 0) {
        return reply.status(404).send({ error: 'No weight recorded on that date.' });
      }
      return { ok: true };
    },
  );
};
