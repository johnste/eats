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

Settings → Agent access takes a secret phrase — something like
`orchard-totem-rust`, or anything else you will remember — and that phrase,
plus the app's address, is everything an AI assistant needs.

The server speaks MCP over Streamable HTTP at `POST /mcp` (for the deployed
app, `https://eats.example.com/mcp`), authenticated with
`Authorization: Bearer <phrase>`. It exposes three tools: `search_foods`,
`log_food` (by `foodId`, or by name plus per-100g macros for something not in
the database) and `get_today`. There is no SSE stream, so `GET /mcp` answers
405; nothing here is server-initiated.

In Claude Code:

```
claude mcp add --transport http eats https://eats.example.com/mcp \
  --header "Authorization: Bearer orchard-totem-rust"
```

Claude.ai custom connectors expect OAuth; a static header needs the
`static_headers` beta. Without it, use Claude Code or any other client that
lets you set a header.

### Why a short phrase is safe here

A memorable phrase has nowhere near the entropy of a random token, so the
phrase is not what makes this hard to break into — the limit on wrong guesses
is. `lib/attempts.ts` allows 10 failures an hour from one address and 100 an
hour in total, which leaves a three-word phrase (505 words, ~27 bits) many
centuries out of reach even for an attacker spread across thousands of hosts.

Two details carry that:

- Only *failures* count against the budget, and the phrase is checked before
  the budget is consulted. A correct phrase is therefore always accepted, so
  nobody can lock you out of your own app by guessing badly on purpose.
- Phrases are stored as argon2id, the same as passwords. If the table ever
  leaked, a SHA-256 digest of three dictionary words would fall in seconds.

A single word is refused at creation time. It is not the length that matters
so much as that one word sits inside the first few thousand guesses anyone
would try, and no rate limit rescues a secret that is in that set.

An agent can log food but cannot read history or weights, cannot delete
anything, and cannot touch the account. Revoking a phrase in Settings takes
effect on the next request.

## Deployment

Self-hosted on Coolify as a single container. See **[DEPLOY.md](DEPLOY.md)** for
the full setup, including the environment variables and why TLS is required for
barcode scanning.

To verify the production image locally before pushing:

```bash
docker build -t eats:local . && docker run --rm -p 3100:3000 \
  -e DATABASE_URL=... -e SESSION_SECRET=... eats:local
```
