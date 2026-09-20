# Eats

Self-hosted calorie and macro tracker. Log what you eat, track weight against a
goal, scan barcodes and nutrition labels with your phone. Built for a handful of
invited users on a Coolify instance, with the data in a Postgres database you own.

## Layout

```
packages/shared   zod schemas and nutrition math, used by both sides
apps/api          Fastify + Drizzle + Postgres
apps/web          React SPA (Vite, Tailwind), installable as a PWA
```

Node 26 strips TypeScript types natively, so **the API has no build step** -- it
runs `src/index.ts` directly in production. `tsc` is used only for typechecking.
Only the SPA is compiled.

## Development

```bash
cp .env.example .env        # then fill in SESSION_SECRET and DATABASE_URL
npm install
npm run db:migrate
npm run dev                 # API on :3000, SPA on :5173 proxying /api
```

| Command | Does |
|---|---|
| `npm run dev` | API and web dev servers together |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm test` | API unit tests (`node --test`) |
| `npm run db:generate` | Write a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |

## Nutrition data

Everything is stored **per 100 g**, so foods are always directly comparable and
scaling to a portion is one multiplication. Serving sizes ("1 slice = 28 g") are
a display convenience layered on top.

Log entries **snapshot** their macros at the moment of logging. If an Open Food
Facts product is later corrected, or you fix a typo in a custom food, your past
days keep the numbers they always had.

Goals are **append-only** with an `effective_from` date: changing your target in
March doesn't retroactively rewrite how January looked.

## Food data

Three sources, searched together and ranked in that order:

1. **Your own foods** -- anything you created or scanned a label for.
2. **Livsmedelsverket** -- the Swedish Food Agency's food database, seeded
   locally by `apps/api/scripts/seed-slv.ts`. Generic Swedish staples that have
   no barcode. Licensed CC BY 4.0; the attribution is in Settings.
3. **Open Food Facts** -- branded packaged products, fetched by barcode on
   demand and cached.

Livsmedelsverket outranks Open Food Facts because it is compiled and analysed
rather than crowd-sourced, and covers the generic foods OFF has only as
somebody's photographed packet.

```bash
node --env-file=.env apps/api/scripts/seed-slv.ts --dry   # preview
node --env-file=.env apps/api/scripts/seed-slv.ts         # import
```

Re-running updates rather than duplicates.

## Agent access (MCP)

The server speaks MCP over Streamable HTTP at `POST /mcp` — for the deployed
app, `https://eats.example.com/mcp`. Three tools: `search_foods`, `log_food`
(by `foodId`, or by name plus per-100g macros for something not in the
database) and `get_today`. There is no SSE stream, so `GET /mcp` answers 405;
nothing here is server-initiated.

There are two ways to authenticate, because clients differ in what they can do.

### OAuth, for Claude connectors

Paste the URL into Claude as a custom connector and approve it in the browser.
Nothing to copy: Eats is its own authorization server, and the consent screen
reuses your ordinary session cookie, so you are already signed in when you
land on it. Settings → Agent access lists what you have connected and
disconnects it.

Claude's connector flow assumes OAuth and has no "no auth" fallback, so the
whole handshake has to work:

| Step | Endpoint |
|---|---|
| 401 names where to sign in | `WWW-Authenticate: Bearer resource_metadata="…"` |
| Protected resource metadata ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)) | `/.well-known/oauth-protected-resource` |
| Authorization server metadata ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)) | `/.well-known/oauth-authorization-server` |
| Dynamic client registration ([RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)) | `POST /oauth/register` |
| Consent, PKCE S256 required | `GET|POST /oauth/authorize` |
| Token exchange and refresh, form-encoded | `POST /oauth/token` |

Access tokens last an hour; refresh tokens rotate on every use, which OAuth
2.1 requires for public clients. Tokens are audience-bound to the MCP URL
([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)), so one minted for
another server is refused here. A replayed authorization code revokes the
tokens it already bought, on the assumption that a code used twice has leaked.

**`PUBLIC_URL` must be the real origin in production.** OAuth metadata states
absolute URLs, so whatever is set there is what clients are told to use. The
process refuses to start if it is left on localhost with `NODE_ENV=production`,
because the alternative is a connector that fails with an error naming nothing
useful.

### A secret phrase, for everything else

For clients that cannot sign in through a browser — Claude Code, scripts —
Settings → Agent access takes a memorable phrase such as `orchard-totem-rust`:

```
claude mcp add --transport http eats https://eats.example.com/mcp \
  --header "Authorization: Bearer orchard-totem-rust"
```

A memorable phrase has nowhere near the entropy of a random token, so the
phrase is not what makes this hard to break into — the limit on wrong guesses
is. `lib/attempts.ts` allows 10 failures an hour from one address and 100 an
hour in total, which leaves a three-word phrase (505 words, ~27 bits) many
centuries out of reach even for an attacker spread across thousands of hosts.

Two details carry that:

- Only *failures* count against the budget, and the phrase is checked before
  the budget is consulted. A correct phrase is therefore always accepted, so
  nobody can lock you out of your own app by guessing badly on purpose. An
  expired OAuth token does not count either — Claude refreshes reactively on a
  401, and that is an ordinary event, not a guess.
- Phrases are stored as argon2id, the same as passwords. If the table ever
  leaked, a SHA-256 digest of three dictionary words would fall in seconds.
  OAuth tokens are SHA-256, which is right for 256 bits of randomness and
  wrong for anything a person chose.

A single word is refused at creation time. It is not the length that matters
so much as that one word sits inside the first few thousand guesses anyone
would try, and no rate limit rescues a secret that is in that set.

### Either way

An agent can log food but cannot read history or weights, cannot delete
anything, and cannot touch the account. Revoking takes effect on the next
request.

Two things that are easy to get wrong and fail silently:

- The SPA fallback must not answer `/.well-known/*`, `/oauth/*` or `/register`.
  Serving `index.html` there gives a client `200 text/html` where it expects
  JSON, so instead of concluding there is no OAuth it tries to parse a web page
  as metadata.
- The service worker's `navigateFallbackDenylist` must exclude the same paths.
  `/oauth/authorize` is a real navigation to a server-rendered page, and an
  installed PWA will otherwise answer it from cache with the app shell — so
  sign-in never completes, and only for people who installed the app.

## Deployment

Self-hosted on Coolify as a single container. See **[DEPLOY.md](DEPLOY.md)** for
the full setup, including the environment variables and why TLS is required for
barcode scanning.

To verify the production image locally before pushing:

```bash
docker build -t eats:local . && docker run --rm -p 3100:3000 \
  -e DATABASE_URL=... -e SESSION_SECRET=... eats:local
```
