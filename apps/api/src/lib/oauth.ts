import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, lt, max, min, or } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { oauthClients, oauthCodes, oauthTokens, users } from '../db/schema.ts';

/**
 * The single scope this server grants. An agent that holds it can search
 * foods, log a meal and read the current day -- the same three tools a
 * secret phrase reaches, and nothing else.
 */
export const SCOPE = 'log';

/** Claude asks for this when the metadata advertises it; it means a refresh token. */
export const OFFLINE_SCOPE = 'offline_access';

const CODE_TTL_MS = 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 60 * 24 * 60 * 60_000;

/**
 * Opaque and random rather than a JWT. Nothing here needs to be verified
 * without a database round trip, and a revocable row beats a signature that
 * stays valid until it expires.
 */
const newSecret = () => randomBytes(32).toString('base64url');

/**
 * SHA-256 with no salt or stretching, which is right for a 256-bit random
 * string and wrong for anything a person chose: there is no guessable input
 * to slow an attacker down over, and lookup has to be by exact hash.
 */
export const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const equal = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** PKCE S256 per RFC 7636. The plain method is deliberately not accepted. */
export const s256 = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

export interface OAuthClient {
  id: string;
  clientName: string;
  redirectUris: string[];
}

export async function registerClient(
  db: Database,
  clientName: string,
  redirectUris: string[],
): Promise<OAuthClient> {
  const [row] = await db
    .insert(oauthClients)
    .values({ clientName, redirectUris })
    .returning();
  if (!row) throw new Error('client insert returned no row');
  return {
    id: row.id,
    clientName: row.clientName,
    redirectUris: row.redirectUris,
  };
}

export async function findClient(
  db: Database,
  clientId: string,
): Promise<OAuthClient | null> {
  const [row] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, clientId))
    .limit(1);
  return row
    ? { id: row.id, clientName: row.clientName, redirectUris: row.redirectUris }
    : null;
}

/**
 * Exact string match, as OAuth 2.1 requires. Claude Code is the one exception
 * the spec carves out: it listens on an ephemeral loopback port, so RFC 8252
 * section 7.3 says the port must be ignored for loopback redirects.
 */
export function redirectAllowed(client: OAuthClient, candidate: string): boolean {
  if (client.redirectUris.includes(candidate)) return true;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return false;

  return client.redirectUris.some((registered) => {
    try {
      const r = new URL(registered);
      return (
        (r.hostname === 'localhost' || r.hostname === '127.0.0.1') &&
        r.protocol === url.protocol &&
        r.pathname === url.pathname
      );
    } catch {
      return false;
    }
  });
}

export async function issueCode(
  db: Database,
  input: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
    resource: string;
  },
): Promise<string> {
  const code = newSecret();
  await db.insert(oauthCodes).values({
    codeHash: hash(code),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope,
    resource: input.resource,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return code;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}

async function mint(
  db: Database,
  input: {
    clientId: string;
    userId: string;
    scope: string;
    resource: string;
    withRefresh: boolean;
  },
): Promise<TokenSet> {
  const accessToken = newSecret();
  const refreshToken = input.withRefresh ? newSecret() : null;
  const now = Date.now();

  await db.insert(oauthTokens).values({
    clientId: input.clientId,
    userId: input.userId,
    accessTokenHash: hash(accessToken),
    refreshTokenHash: refreshToken ? hash(refreshToken) : null,
    scope: input.scope,
    resource: input.resource,
    accessExpiresAt: new Date(now + ACCESS_TTL_MS),
    refreshExpiresAt: refreshToken ? new Date(now + REFRESH_TTL_MS) : null,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
    scope: input.scope,
  };
}

export type ExchangeError = 'invalid_grant' | 'invalid_client' | 'invalid_request';

/** Redeem an authorization code. Single use: a replay revokes what it bought. */
export async function exchangeCode(
  db: Database,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  },
): Promise<TokenSet | ExchangeError> {
  const codeHash = hash(input.code);
  const [row] = await db
    .select()
    .from(oauthCodes)
    .where(eq(oauthCodes.codeHash, codeHash))
    .limit(1);

  if (!row) return 'invalid_grant';

  if (row.usedAt) {
    // A code presented twice means it leaked. OAuth 2.1 requires revoking
    // everything already issued from it rather than just refusing the replay.
    await db
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(oauthTokens.userId, row.userId), eq(oauthTokens.clientId, row.clientId)),
      );
    return 'invalid_grant';
  }

  await db
    .update(oauthCodes)
    .set({ usedAt: new Date() })
    .where(eq(oauthCodes.codeHash, codeHash));

  if (row.expiresAt.getTime() < Date.now()) return 'invalid_grant';
  if (row.clientId !== input.clientId) return 'invalid_grant';
  if (row.redirectUri !== input.redirectUri) return 'invalid_grant';
  if (!equal(row.codeChallenge, s256(input.codeVerifier))) return 'invalid_grant';

  return mint(db, {
    clientId: row.clientId,
    userId: row.userId,
    scope: row.scope,
    resource: row.resource,
    withRefresh: row.scope.split(' ').includes(OFFLINE_SCOPE),
  });
}

/**
 * Refresh, rotating the refresh token. Claude registers as a public client,
 * which OAuth 2.1 requires rotation for; the new token comes back in the same
 * response that retires the old one.
 */
export async function refresh(
  db: Database,
  input: { refreshToken: string; clientId: string },
): Promise<TokenSet | ExchangeError> {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.refreshTokenHash, hash(input.refreshToken)))
    .limit(1);

  if (!row || row.revokedAt) return 'invalid_grant';
  if (row.clientId !== input.clientId) return 'invalid_grant';
  if (!row.refreshExpiresAt || row.refreshExpiresAt.getTime() < Date.now()) {
    return 'invalid_grant';
  }

  await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthTokens.id, row.id));

  return mint(db, {
    clientId: row.clientId,
    userId: row.userId,
    scope: row.scope,
    resource: row.resource,
    withRefresh: true,
  });
}

export interface TokenBearer {
  id: string;
  email: string;
  displayName: string;
  tokenId: string;
  scope: string;
}

/**
 * Resolve an access token, checking that it was issued for this server.
 * Audience validation is the whole point of RFC 8707: a token minted for
 * somewhere else must never be accepted here.
 */
export async function resolveAccessToken(
  db: Database,
  presented: string,
  audience: string,
): Promise<TokenBearer | null> {
  const [row] = await db
    .select({
      tokenId: oauthTokens.id,
      scope: oauthTokens.scope,
      resource: oauthTokens.resource,
      expiresAt: oauthTokens.accessExpiresAt,
      revokedAt: oauthTokens.revokedAt,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(oauthTokens)
    .innerJoin(users, eq(users.id, oauthTokens.userId))
    .where(eq(oauthTokens.accessTokenHash, hash(presented)))
    .limit(1);

  if (!row || row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  if (row.resource !== audience) return null;
  if (!row.scope.split(' ').includes(SCOPE)) return null;

  void db
    .update(oauthTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthTokens.id, row.tokenId))
    .catch(() => {});

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    tokenId: row.tokenId,
    scope: row.scope,
  };
}

/**
 * The apps you have connected, one row per client rather than per token --
 * a refresh rotation makes a new row every hour and you do not want to see
 * that in Settings.
 */
export async function listGrants(db: Database, userId: string) {
  return db
    .select({
      clientId: oauthTokens.clientId,
      clientName: oauthClients.clientName,
      connectedAt: min(oauthTokens.createdAt),
      lastUsedAt: max(oauthTokens.lastUsedAt),
    })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
    .where(and(eq(oauthTokens.userId, userId), isNull(oauthTokens.revokedAt)))
    .groupBy(oauthTokens.clientId, oauthClients.clientName);
}

/** Cut an app off. Takes effect on its next request -- there is no cache. */
export async function revokeGrant(
  db: Database,
  userId: string,
  clientId: string,
): Promise<number> {
  const rows = await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.clientId, clientId),
        isNull(oauthTokens.revokedAt),
      ),
    )
    .returning({ id: oauthTokens.id });
  return rows.length;
}

/** Housekeeping for rows that can no longer authorize anything. */
export async function pruneOauth(db: Database): Promise<void> {
  const now = new Date();
  await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now));
  await db
    .delete(oauthTokens)
    .where(
      and(
        lt(oauthTokens.accessExpiresAt, now),
        or(isNull(oauthTokens.refreshExpiresAt), lt(oauthTokens.refreshExpiresAt, now)),
      ),
    );
}
