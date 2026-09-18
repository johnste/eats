import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDb } from './client.ts';
import { loadEnv } from '../env.ts';

/**
 * A container almost always starts before its database is reachable, and on
 * some platforms the database's DNS name does not resolve for a few seconds
 * either. Crashing instantly on the first failure turns an ordinary race into
 * a crash loop, so wait a bounded while first.
 */
async function waitForDatabase(
  connectionString: string,
  { attempts = 15, delayMs = 2000 } = {},
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { sql, close } = createDb(connectionString, { max: 1 });
    try {
      await sql`select 1`;
      await close();
      return;
    } catch (err) {
      lastError = err;
      await close().catch(() => {});
      const code = (err as NodeJS.ErrnoException).code;
      // Name resolution failing usually means the app and the database are not
      // on the same network -- worth saying, because the driver error alone
      // sends you looking at credentials instead.
      const hint =
        code === 'EAI_AGAIN' || code === 'ENOTFOUND'
          ? " (hostname didn't resolve -- is the app on the same network as the database?)"
          : '';
      console.warn(
        `database not reachable, attempt ${attempt}/${attempts}${hint}: ${
          (err as Error).message
        }`,
      );
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `Database unreachable after ${attempts} attempts. Last error: ${
      (lastError as Error)?.message ?? 'unknown'
    }`,
  );
}

/**
 * Run on every boot in production, so a deploy that includes a migration
 * applies it without a separate release step.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  await waitForDatabase(connectionString);

  const { db, close } = createDb(connectionString, { max: 1 });
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  await runMigrations(env.DATABASE_URL);
  console.log('migrations applied');
}
