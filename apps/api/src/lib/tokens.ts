import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { apiTokens, users } from '../db/schema.ts';
import { hashPassword, verifyPassword } from './auth.ts';
import { generatePassphrase } from './passphrase.ts';

export interface TokenOwner {
  id: string;
  email: string;
  displayName: string;
  tokenId: string;
}

/**
 * Short enough that a phrase like `orchard-totem-rust` passes and a single
 * word does not. The length itself is not what protects the secret -- the
 * failed-attempt limiter does that -- but a one-word secret sits inside the
 * few thousand guesses any attacker tries first, and no rate limit saves you
 * from being in that set.
 */
export const MIN_SECRET_LENGTH = 12;

/**
 * Secrets people actually choose when asked for a memorable word. Guarding
 * the top of the distribution is worth more than any length rule.
 */
const OBVIOUS = new Set([
  'password',
  'passphrase',
  'letmein',
  'secretword',
  'changeme',
  'iloveyou',
  'qwertyuiop',
  'administrator',
  'openseseme',
  'opensesame',
]);

export function secretProblem(secret: string): string | null {
  const trimmed = secret.trim();
  if (trimmed.length < MIN_SECRET_LENGTH) {
    return `Use at least ${MIN_SECRET_LENGTH} characters — three short words works well.`;
  }
  if (trimmed.length > 200) return 'That is longer than it needs to be.';
  const flat = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (OBVIOUS.has(flat)) return 'That is one of the first things anyone would try.';
  if (/^(.)\1+$/.test(flat)) return 'That is a single character repeated.';
  return null;
}

export { generatePassphrase };

/**
 * Enough to recognise a secret in a list without being enough to use it.
 * Only the first word survives, because that is what you remember it by.
 */
export const secretHint = (secret: string): string => {
  const [first = ''] = secret.split(/[-\s]/);
  return `${first}-…`;
};

export async function createToken(
  db: Database,
  userId: string,
  name: string,
  secret: string,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      name,
      hint: secretHint(secret),
      // argon2id, the same as a password. A three-word phrase has nothing
      // like the entropy of the old random token, so if this table ever
      // leaks, the hash has to be what makes guessing expensive.
      tokenHash: await hashPassword(secret),
    })
    .returning({ id: apiTokens.id });
  if (!row) throw new Error('token insert returned no row');
  return { id: row.id };
}

export const listTokens = (db: Database, userId: string) =>
  db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      hint: apiTokens.hint,
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
 * Resolve a presented secret to its owner, or null.
 *
 * There is no username to look the row up by, so every active token is
 * verified in turn. That is fine at this scale (a person has one or two) and
 * it is also why the caller must rate-limit failures: each miss costs a full
 * argon2 verification per token, which is exactly the work an attacker would
 * like to make the server do.
 */
export async function resolveToken(
  db: Database,
  presented: string,
): Promise<TokenOwner | null> {
  const secret = presented.trim();
  if (!secret) return null;

  const rows = await db
    .select({
      tokenId: apiTokens.id,
      tokenHash: apiTokens.tokenHash,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(isNull(apiTokens.revokedAt))
    .limit(50);

  for (const row of rows) {
    if (!(await verifyPassword(secret, row.tokenHash))) continue;

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

  return null;
}
