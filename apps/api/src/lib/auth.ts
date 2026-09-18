import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Database, Executor } from '../db/client.ts';
import { invites, sessions, users } from '../db/schema.ts';

export const SESSION_COOKIE = 'eats_session';
const SESSION_TTL_DAYS = 60;

/**
 * OWASP's argon2id baseline. Deliberately slow: this runs twice in the whole
 * app (register and login), so the cost is invisible to users and expensive
 * for anyone working through a stolen database dump.
 */
const ARGON_OPTS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (plain: string): Promise<string> =>
  hash(plain, ARGON_OPTS);

export async function verifyPassword(
  plain: string,
  digest: string,
): Promise<boolean> {
  try {
    return await verify(digest, plain, ARGON_OPTS);
  } catch {
    // A malformed hash in the database is a failed login, not a 500.
    return false;
  }
}

/** Emails are compared and stored lowercased; addresses aren't case-sensitive. */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

export const newSessionToken = (): string => randomBytes(32).toString('base64url');

export function sessionExpiry(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + SESSION_TTL_DAYS);
  return d;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

/** Resolve a cookie value to a user, treating expired rows as absent. */
export async function resolveSession(
  db: Database,
  token: string,
): Promise<SessionUser | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSession(db: Database, userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = newSessionToken();
  const expiresAt = sessionExpiry();
  await db.insert(sessions).values({ id: token, userId, expiresAt });
  return { token, expiresAt };
}

export const destroySession = (db: Database, token: string): Promise<unknown> =>
  db.delete(sessions).where(eq(sessions.id, token));

/** Housekeeping: drop rows that can no longer authenticate anyone. */
export const purgeExpiredSessions = (db: Database): Promise<unknown> =>
  db.delete(sessions).where(lt(sessions.expiresAt, new Date()));

export class InviteError extends Error {}

/**
 * Claim an invite for a new user. Runs inside the registration transaction:
 * the conditional UPDATE is what makes a code single-use even if two people
 * submit the same one simultaneously -- the second update matches no rows.
 */
export async function claimInvite(
  tx: Executor,
  code: string,
  userId: string,
): Promise<void> {
  const claimed = await tx
    .update(invites)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(
      and(
        eq(invites.code, code),
        isNull(invites.usedBy),
        or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
      ),
    )
    .returning({ code: invites.code });

  if (claimed.length === 0) {
    throw new InviteError('That invite code is not valid, or has already been used.');
  }
}
