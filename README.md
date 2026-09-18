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

## Deployment

Self-hosted on Coolify as a single container. See **[DEPLOY.md](DEPLOY.md)** for
the full setup, including the environment variables and why TLS is required for
barcode scanning.

To verify the production image locally before pushing:

```bash
docker build -t eats:local . && docker run --rm -p 3100:3000 \
  -e DATABASE_URL=... -e SESSION_SECRET=... eats:local
```
