import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDb } from './client.ts';
import { loadEnv } from '../env.ts';

/**
 * Run on every boot in production, so a deploy that includes a migration
 * applies it without a separate release step.
 */
export async function runMigrations(connectionString: string): Promise<void> {
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
