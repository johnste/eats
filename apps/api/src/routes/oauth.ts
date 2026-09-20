import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.ts';
import {
  exchangeCode,
  findClient,
  issueCode,
  OFFLINE_SCOPE,
  redirectAllowed,
  refresh,
  registerClient,
  SCOPE,
  type OAuthClient,
} from '../lib/oauth.ts';

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** The consent form is a state-changing POST, so it needs its own token. */
const csrfFor = (secret: string, sessionToken: string, clientId: string): string =>
  createHmac('sha256', secret).update(`${sessionToken}:${clientId}`).digest('hex');

const csrfValid = (expected: string, given: string): boolean => {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

function page(title: string, body: string): string {
  // Self-contained rather than the SPA: this screen has to render for someone
  // arriving from claude.ai with nothing loaded, and it must not depend on
  // JavaScript to say what is being granted.
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Eats</title>
<style>
  :root{color-scheme:light dark;--bg:#f7f8f8;--card:#fff;--ink:#1d2125;--muted:#5d6570;
        --line:#e4e7e9;--accent:#1f9d61;--accent-soft:#e6f5ed;--danger:#c0392b}
  @media(prefers-color-scheme:dark){:root{--bg:#16191c;--card:#22262a;--ink:#f2f4f5;
        --muted:#a3abb5;--line:#343a40;--accent:#45c98a;--accent-soft:#1d3a2c}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;
       background:var(--bg);color:var(--ink);
       font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  main{width:100%;max-width:26rem;background:var(--card);border:1px solid var(--line);
       border-radius:16px;padding:24px}
  h1{margin:0 0 4px;font-size:19px;letter-spacing:-.011em}
  p{margin:0 0 16px;color:var(--muted);font-size:14px}
  ul{margin:0 0 20px;padding:0;list-style:none;font-size:14px}
  li{padding:8px 0;border-top:1px solid var(--line);display:flex;gap:8px}
  li::before{content:"✓";color:var(--accent);font-weight:600}
  .who{font-weight:600;color:var(--ink)}
  .row{display:flex;gap:8px;margin-top:4px}
  button{flex:1;min-height:44px;border:0;border-radius:12px;font:inherit;font-size:15px;
         font-weight:500;cursor:pointer}
  .approve{background:var(--accent);color:#fff}
  .deny{background:transparent;color:var(--muted);border:1px solid var(--line)}
  .note{font-size:12px;color:var(--muted);margin:16px 0 0}
  .err{color:var(--danger)}
</style></head><body><main>${body}</main></body></html>`;
}

const errorPage = (
  reply: FastifyReply,
  status: number,
  title: string,
  detail: string,
) =>
  reply
    .status(status)
    .type('text/html; charset=utf-8')
    .send(page(title, `<h1>${esc(title)}</h1><p class="err">${esc(detail)}</p>`));

/** Push an OAuth error back to the client, which is where it can be handled. */
function redirectError(
  reply: FastifyReply,
  redirectUri: string,
  code: string,
  state: string | undefined,
  description?: string,
) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', code);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return reply.redirect(url.toString(), 302);
}

interface AuthorizeParams {
  client: OAuthClient;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scope: string;
  resource: string;
}

export const oauthRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  const { db, env } = deps;
  const issuer = env.PUBLIC_URL;
  const mcpUrl = `${issuer}/mcp`;

  /* ------------------------------------------------------------ metadata --- */

  // RFC 9728. Claude probes the path-suffixed form first, then the bare one,
  // and either way the `resource` must equal the URL the user typed.
  const protectedResource = {
    resource: mcpUrl,
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Eats',
    resource_documentation: `${issuer}/settings`,
  };

  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ]) {
    app.get(path, async (_req, reply) =>
      reply.header('cache-control', 'public, max-age=3600').send(protectedResource),
    );
  }

  // RFC 8414. token_endpoint_auth_methods_supported must list "none": Claude
  // registers as a public client and authenticates with PKCE, not a secret.
  const authServerMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    scopes_supported: [SCOPE, OFFLINE_SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    service_documentation: `${issuer}/settings`,
  };

  for (const path of [
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/mcp',
  ]) {
    app.get(path, async (_req, reply) =>
      reply.header('cache-control', 'public, max-age=3600').send(authServerMetadata),
    );
  }

  /* -------------------------------------------------- client registration --- */

  app.post(
    '/oauth/register',
    // Registration is necessarily open -- that is what makes "paste the URL"
    // work -- so the cap is what stops the table filling with junk. Nothing
    // is granted by registering; consent still happens in a browser.
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
      const redirectUris = uris.filter((u): u is string => typeof u === 'string');

      if (redirectUris.length === 0) {
        return reply.status(400).send({
          error: 'invalid_redirect_uri',
          error_description: 'redirect_uris is required.',
        });
      }
      for (const uri of redirectUris) {
        let parsed: URL;
        try {
          parsed = new URL(uri);
        } catch {
          return reply.status(400).send({
            error: 'invalid_redirect_uri',
            error_description: `Not a URL: ${uri}`,
          });
        }
        // OAuth 2.1: https everywhere except loopback, which native clients
        // such as Claude Code need.
        const loopback =
          parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        if (parsed.protocol !== 'https:' && !loopback) {
          return reply.status(400).send({
            error: 'invalid_redirect_uri',
            error_description: 'Redirect URIs must use https, or be loopback.',
          });
        }
      }

      const name =
        typeof body.client_name === 'string' && body.client_name.trim()
          ? body.client_name.trim().slice(0, 120)
          : 'Unnamed client';

      const client = await registerClient(db, name, redirectUris);

      return reply
        .status(201)
        .header('cache-control', 'no-store')
        .send({
          client_id: client.id,
          client_name: client.clientName,
          redirect_uris: client.redirectUris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          client_id_issued_at: Math.floor(Date.now() / 1000),
        });
    },
  );

  /* --------------------------------------------------------- authorize --- */

  /**
   * Validate far enough to know whether the redirect_uri can be trusted.
   * Until it is, an error must be shown on our own page: bouncing to an
   * unverified URI is how open redirects happen.
   */
  async function readParams(
    req: FastifyRequest,
    reply: FastifyReply,
    raw: Record<string, unknown>,
  ): Promise<AuthorizeParams | null> {
    const str = (k: string): string | undefined =>
      typeof raw[k] === 'string' ? (raw[k] as string) : undefined;

    const clientId = str('client_id');
    const redirectUri = str('redirect_uri');
    const state = str('state');

    if (!clientId) {
      await errorPage(reply, 400, 'Missing client', 'No client_id was given.');
      return null;
    }
    const client = await findClient(db, clientId);
    if (!client) {
      await errorPage(
        reply,
        400,
        'Unknown client',
        'This application is not registered with Eats. It may have been removed.',
      );
      return null;
    }
    if (!redirectUri || !redirectAllowed(client, redirectUri)) {
      await errorPage(
        reply,
        400,
        'Bad redirect',
        'The redirect address does not match the one this application registered.',
      );
      return null;
    }

    // From here the redirect target is trusted, so failures go back to it.
    if (str('response_type') !== 'code') {
      await redirectError(reply, redirectUri, 'unsupported_response_type', state);
      return null;
    }
    const codeChallenge = str('code_challenge');
    if (!codeChallenge || str('code_challenge_method') !== 'S256') {
      await redirectError(
        reply,
        redirectUri,
        'invalid_request',
        state,
        'PKCE with S256 is required.',
      );
      return null;
    }

    // RFC 8707. Absent is tolerated for older clients; wrong is not, because
    // a token minted for another audience must never work here.
    const resource = str('resource') ?? mcpUrl;
    if (resource.replace(/\/+$/, '') !== mcpUrl) {
      await redirectError(
        reply,
        redirectUri,
        'invalid_target',
        state,
        `This server only issues tokens for ${mcpUrl}.`,
      );
      return null;
    }

    const requested = (str('scope') ?? SCOPE).split(/\s+/).filter(Boolean);
    const unknown = requested.filter((s) => s !== SCOPE && s !== OFFLINE_SCOPE);
    if (unknown.length > 0) {
      await redirectError(
        reply,
        redirectUri,
        'invalid_scope',
        state,
        `Unknown scope: ${unknown.join(' ')}`,
      );
      return null;
    }
    const scope = [
      SCOPE,
      ...(requested.includes(OFFLINE_SCOPE) ? [OFFLINE_SCOPE] : []),
    ];

    return {
      client,
      redirectUri,
      state,
      codeChallenge,
      scope: scope.join(' '),
      resource: mcpUrl,
    };
  }

  app.get('/oauth/authorize', async (req, reply) => {
    const raw = (req.query ?? {}) as Record<string, unknown>;
    const params = await readParams(req, reply, raw);
    if (!params) return reply;

    if (!req.user) {
      // Sign in first, then come straight back. The SPA only follows `next`
      // when it is a path on this origin, so this cannot be turned outward.
      const next = `/oauth/authorize?${new URLSearchParams(
        Object.entries(raw).filter(
          (e): e is [string, string] => typeof e[1] === 'string',
        ),
      ).toString()}`;
      return reply.redirect(`/login?next=${encodeURIComponent(next)}`, 302);
    }

    const hidden = Object.entries(raw)
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
      .join('');

    const csrf = csrfFor(
      env.SESSION_SECRET,
      req.cookies.eats_session ?? '',
      params.client.id,
    );
    const offline = params.scope.includes(OFFLINE_SCOPE);

    return reply.type('text/html; charset=utf-8').send(
      page(
        'Connect',
        `<h1>Connect ${esc(params.client.clientName)}?</h1>
         <p>Signed in as ${esc(req.user.email)}. This will let it:</p>
         <ul>
           <li>Search foods you and Eats already know about</li>
           <li>Add food to a meal on your log</li>
           <li>Read back what you have eaten today</li>
         </ul>
         <p>It cannot see your weight or past days, cannot delete anything,
            and cannot change your account.</p>
         <form method="post" action="/oauth/authorize">
           ${hidden}
           <input type="hidden" name="csrf" value="${esc(csrf)}">
           <div class="row">
             <button class="deny" name="decision" value="deny" type="submit">Cancel</button>
             <button class="approve" name="decision" value="allow" type="submit">Allow</button>
           </div>
         </form>
         <p class="note">${
           offline
             ? 'Access stays valid until you revoke it in Settings.'
             : 'Access expires in an hour.'
         }</p>`,
      ),
    );
  });

  app.post(
    '/oauth/authorize',
    { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const params = await readParams(req, reply, raw);
      if (!params) return reply;

      if (!req.user) {
        return errorPage(reply, 401, 'Signed out', 'Sign in to Eats and try again.');
      }

      const expected = csrfFor(
        env.SESSION_SECRET,
        req.cookies.eats_session ?? '',
        params.client.id,
      );
      const given = typeof raw.csrf === 'string' ? raw.csrf : '';
      if (!csrfValid(expected, given)) {
        return errorPage(
          reply,
          400,
          'Expired form',
          'This page was left open too long, or came from somewhere else. Start again from the app you are connecting.',
        );
      }

      if (raw.decision !== 'allow') {
        return redirectError(reply, params.redirectUri, 'access_denied', params.state);
      }

      const code = await issueCode(db, {
        clientId: params.client.id,
        userId: req.user.id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        scope: params.scope,
        resource: params.resource,
      });

      req.log.info(
        { client: params.client.id, user: req.user.id },
        'oauth consent granted',
      );

      const url = new URL(params.redirectUri);
      url.searchParams.set('code', code);
      if (params.state) url.searchParams.set('state', params.state);
      return reply.redirect(url.toString(), 302);
    },
  );

  /* ------------------------------------------------------------- token --- */

  app.post(
    '/oauth/token',
    { config: { rateLimit: { max: 60, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const str = (k: string): string | undefined =>
        typeof body[k] === 'string' ? (body[k] as string) : undefined;

      reply.header('cache-control', 'no-store');

      const fail = (error: string, description?: string) =>
        reply.status(400).send({ error, error_description: description });

      const clientId = str('client_id');
      if (!clientId) return fail('invalid_client', 'client_id is required.');

      const grant = str('grant_type');

      if (grant === 'authorization_code') {
        const code = str('code');
        const redirectUri = str('redirect_uri');
        const verifier = str('code_verifier');
        if (!code || !redirectUri || !verifier) {
          return fail(
            'invalid_request',
            'code, redirect_uri and code_verifier are required.',
          );
        }
        const result = await exchangeCode(db, {
          code,
          clientId,
          redirectUri,
          codeVerifier: verifier,
        });
        if (typeof result === 'string') return fail(result);
        return reply.send({
          access_token: result.accessToken,
          token_type: 'Bearer',
          expires_in: result.expiresIn,
          scope: result.scope,
          ...(result.refreshToken ? { refresh_token: result.refreshToken } : {}),
        });
      }

      if (grant === 'refresh_token') {
        const token = str('refresh_token');
        if (!token) return fail('invalid_request', 'refresh_token is required.');
        const result = await refresh(db, { refreshToken: token, clientId });
        if (typeof result === 'string') return fail(result);
        return reply.send({
          access_token: result.accessToken,
          token_type: 'Bearer',
          expires_in: result.expiresIn,
          scope: result.scope,
          ...(result.refreshToken ? { refresh_token: result.refreshToken } : {}),
        });
      }

      return fail('unsupported_grant_type');
    },
  );
};
