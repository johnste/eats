import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Database = ReturnType<typeof createDb>['db'];

/**
 * The callback argument of db.transaction(). Helpers that must work both
 * inside and outside a transaction take an Executor rather than a Database.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

export function createDb(connectionString: string, opts: { max?: number } = {}) {
  const sql = postgres(connectionString, {
    max: opts.max ?? 10,
    // Dates come back as YYYY-MM-DD strings rather than Date objects, which is
    // what the whole app treats a calendar day as.
    types: {},
    // Migrations use CREATE ... IF NOT EXISTS, so every boot after the first
    // emits "already exists, skipping" notices. They are not problems, and
    // printing them buries the ones that are.
    onnotice: (notice) => {
      if (notice.code === '42P06' || notice.code === '42P07') return;
      console.warn(`postgres: ${notice.message}`);
    },
  });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
