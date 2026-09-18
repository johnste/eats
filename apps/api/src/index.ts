import { sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { createDb, type Database } from './db/client.ts';
import { invites, users } from './db/schema.ts';
import { runMigrations } from './db/migrate.ts';
import { loadEnv } from './env.ts';
import { purgeExpiredSessions } from './lib/auth.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Registration needs an invite, which leaves a fresh deployment with no way in.
 * This seeds one code, but only while there are no users -- once anyone has
 * registered, the bootstrap code is inert and further invites are issued by
 * existing users.
 */
async function seedBootstrapInvite(db: Database, code: string): Promise<void> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  if (count > 0) return;
  await db.insert(invites).values({ code }).onConflictDoNothing();
}

const env = loadEnv();

if (env.NODE_ENV === 'production') {
  await runMigrations(env.DATABASE_URL);
}

const { db, close } = createDb(env.DATABASE_URL);

if (env.INVITE_BOOTSTRAP_CODE) {
  await seedBootstrapInvite(db, env.INVITE_BOOTSTRAP_CODE);
}
await purgeExpiredSessions(db);

// In the production image the SPA is built next to the API; in dev Vite serves
// it, and leaving WEB_DIST unset keeps this process API-only.
const defaultWebDist = join(here, '..', '..', 'web', 'dist');
const webDist =
  env.WEB_DIST ?? (env.NODE_ENV === 'production' && existsSync(defaultWebDist)
    ? defaultWebDist
    : undefined);

const app = await buildApp({ db, env: { ...env, WEB_DIST: webDist } });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    void app.close().then(close).then(() => process.exit(0));
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
