import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { apiTokens, users } from '../db/schema.ts';

/** Recognisable in a log or a config file, and greppable if one leaks. */
const PREFIX = 'eats_';

export interface TokenOwner {
  id: string;
  email: string;
  displayName: string;
  tokenId: string;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function generateToken(): string {
  return `${PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** Enough to identify a token in a list without being enough to use it. */
export const tokenHint = (token: string): string =>
  `${PREFIX}…${token.slice(-6)}`;

export async function createToken(
  db: Database,
  userId: string,
  name: string,
): Promise<{ token: string; id: string }> {
  const token = generateToken();
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, name, tokenHash: hashToken(token) })
    .returning({ id: apiTokens.id });
  if (!row) throw new Error('token insert returned no row');
  // Returned once and never again -- only the hash is stored.
  return { token, id: row.id };
}

export const listTokens = (db: Database, userId: string) =>
  db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));

export const revokeToken = (db: Database, userId: string, id: string) =>
  db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
    .returning({ id: apiTokens.id });

/**
 * Resolve a bearer token to its owner, or null.
 *
 * The hash is compared in SQL, but the raw hashes are also compared in
 * constant time afterwards so a narrowing attack against the index cannot
 * learn anything from response timing.
 */
export async function resolveToken(
  db: Database,
  presented: string,
): Promise<TokenOwner | null> {
  if (!presented.startsWith(PREFIX)) return null;
  const hash = hashToken(presented);

  const [row] = await db
    .select({
      tokenId: apiTokens.id,
      tokenHash: apiTokens.tokenHash,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)))
    .limit(1);

  if (!row) return null;
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Fire-and-forget: a failed bookkeeping write must not fail the request.
  void db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.tokenId))
    .catch(() => {});

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    tokenId: row.tokenId,
  };
}
