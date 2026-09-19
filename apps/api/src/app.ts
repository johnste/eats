import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { join } from 'node:path';
import type { Database } from './db/client.ts';
import type { Env } from './env.ts';
import { resolveSession, SESSION_COOKIE, type SessionUser } from './lib/auth.ts';
import type { OffClient } from './lib/off.ts';
import { authRoutes } from './routes/auth.ts';
import { exportRoutes } from './routes/export.ts';
import { foodRoutes } from './routes/foods.ts';
import { logRoutes } from './routes/log.ts';
import { mcpRoutes } from './routes/mcp.ts';
import { meRoutes } from './routes/me.ts';
import { ocrRoutes } from './routes/ocr.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the session hook; null when unauthenticated. */
    user: SessionUser | null;
  }
}

export interface AppDeps {
  db: Database;
  env: Env;
  off: OffClient;
}

/** 401 unless a valid session cookie resolved to a user. */
export async function requireUser(req: FastifyRequest): Promise<SessionUser> {
  if (!req.user) {
    const err = new Error('Not signed in') as Error & { statusCode?: number };
    err.statusCode = 401;
    throw err;
  }
  return req.user;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      // Never let a password or session token reach the log.
      redact: ['req.headers.cookie', 'req.headers.authorization'],
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(multipart, { limits: { files: 1, fileSize: 12 * 1024 * 1024 } });
  await app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
  });

  app.decorateRequest('user', null);

  // Resolve the session once per request so routes can just read req.user.
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? await resolveSession(deps.db, token) : null;
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) req.log.error({ err: error }, 'request failed');
    // Validation failures carry useful detail; 500s must not leak internals.
    const message =
      status >= 500 ? 'Something went wrong.' : error.message || 'Request failed.';
    reply.status(status).send({ error: message });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: '/api/auth', ...deps });
  await app.register(foodRoutes, { prefix: '/api/foods', ...deps });
  await app.register(logRoutes, { prefix: '/api/log', ...deps });
  await app.register(ocrRoutes, { prefix: '/api/foods', ...deps });
  await app.register(meRoutes, { prefix: '/api', ...deps });
  await app.register(exportRoutes, { prefix: '/api', ...deps });
  // Not under /api: an MCP endpoint is its own protocol surface, and the URL
  // is what gets pasted into a connector.
  await app.register(mcpRoutes, { ...deps });

  // In production the same process serves the built SPA. Unknown non-API paths
  // fall through to index.html so client-side routes survive a hard refresh.
  if (env.WEB_DIST) {
    await app.register(fastifyStatic, { root: env.WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export const webDistPath = (apiDir: string): string =>
  join(apiDir, '..', '..', 'web', 'dist');
