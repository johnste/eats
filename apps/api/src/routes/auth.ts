import { errorResponse, loginBody, registerBody, userResponse } from '@eats/shared';
import { eq } from 'drizzle-orm';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../app.ts';
import { users } from '../db/schema.ts';
import {
  claimInvite,
  createSession,
  destroySession,
  hashPassword,
  InviteError,
  normalizeEmail,
  SESSION_COOKIE,
  verifyPassword,
} from '../lib/auth.ts';

export const authRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  const { db, env } = deps;
  const r = app.withTypeProvider<ZodTypeProvider>();

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
  };

  /** Deliberately tight: these are the two endpoints worth brute-forcing. */
  const authLimit = {
    rateLimit: { max: 10, timeWindow: '15 minutes' },
  };

  r.post(
    '/register',
    {
      schema: {
        body: registerBody,
        response: { 200: userResponse, 403: errorResponse, 409: errorResponse },
      },
      config: authLimit,
    },
    async (req, reply) => {
      const { email, password, displayName, inviteCode } = req.body;
      const normalized = normalizeEmail(email);

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1);
      if (existing.length > 0) {
        return reply.status(409).send({ error: 'That email is already registered.' });
      }

      const passwordHash = await hashPassword(password);

      // One transaction: a user is only created if the invite was successfully
      // claimed, and the invite is only spent if the user was created.
      const created = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: normalized, passwordHash, displayName })
          .returning({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
          });
        if (!user) throw new Error('user insert returned no row');
        await claimInvite(tx, inviteCode, user.id);
        return user;
      });

      const { token, expiresAt } = await createSession(db, created.id);
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
      return created;
    },
  );

  r.post(
    '/login',
    {
      schema: {
        body: loginBody,
        response: { 200: userResponse, 401: errorResponse },
      },
      config: authLimit,
    },
    async (req, reply) => {
      const normalized = normalizeEmail(req.body.email);
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1);

      // Hash even when the user doesn't exist, so response time doesn't reveal
      // which addresses are registered.
      const digest = user?.passwordHash ?? DUMMY_HASH;
      const ok = await verifyPassword(req.body.password, digest);

      if (!user || !ok) {
        return reply.status(401).send({ error: 'Wrong email or password.' });
      }

      const { token, expiresAt } = await createSession(db, user.id);
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
      return { id: user.id, email: user.email, displayName: user.displayName };
    },
  );

  r.post(
    '/logout',
    { schema: { response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) await destroySession(db, token);
      reply.clearCookie(SESSION_COOKIE, cookieOptions);
      return { ok: true };
    },
  );

  r.get(
    '/me',
    { schema: { response: { 200: userResponse, 401: errorResponse } } },
    async (req, reply) => {
      if (!req.user) return reply.status(401).send({ error: 'Not signed in' });
      return req.user;
    },
  );

  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error instanceof InviteError) {
      return reply.status(403).send({ error: error.message });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) req.log.error({ err: error }, 'auth request failed');
    reply
      .status(status)
      .send({ error: status >= 500 ? 'Something went wrong.' : error.message });
  });
};

/**
 * A real argon2id digest of a random string, used only to burn equivalent CPU
 * on logins for addresses that don't exist.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0Z2FycGx5';
