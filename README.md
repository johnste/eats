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

## Deployment (Coolify)

One container. The API serves `/api/*` and falls through to the built SPA, so
client-side routes survive a hard refresh. Migrations run on boot, so a deploy
carrying a schema change applies it with no separate release step.

1. Add a **Postgres** service in Coolify.
2. Create an application from this repository, build pack **Dockerfile**.
3. Set the environment variables below.
4. Point the healthcheck at `/api/health`.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | From the Coolify Postgres service |
| `SESSION_SECRET` | 32+ chars. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `INVITE_BOOTSTRAP_CODE` | Lets you register the first account; inert once any user exists |
| `OFF_USER_AGENT` | Open Food Facts rate-limits on this; make it descriptive |
| `NODE_ENV` | `production` |

Coolify terminates TLS, which barcode scanning needs — `getUserMedia` requires
a secure context, so scanning cannot be tested over a plain LAN address.

To verify the image locally before pushing:

```bash
docker build -t eats:local . && docker run --rm -p 3100:3000 \
  -e DATABASE_URL=... -e SESSION_SECRET=... eats:local
```
