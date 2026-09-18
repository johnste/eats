# Deploying Eats to Coolify

One container. The API serves `/api/*` and falls through to the built SPA, so
client-side routes survive a hard refresh. Migrations run on boot, so a deploy
carrying a schema change applies it with no separate release step.

---

## 1. Create the Postgres service

**Project → + New → Database → PostgreSQL 17.**

Name it `eats-db`. Once it starts, open it and copy the **internal** connection
URL — the one using the service hostname, not `localhost`. It looks like:

```
postgres://postgres:<password>@<service-name>:5432/postgres
```

Use the internal URL: the app talks to Postgres over Coolify's internal network,
and there is no reason to expose the database publicly.

## 2. Create the application

**+ New → Application → Public Repository** (or Private, via your GitHub app)
and point it at the `eats` repository.

| Setting | Value |
|---|---|
| Build Pack | **Dockerfile** |
| Dockerfile location | `/Dockerfile` |
| Branch | `main` |
| Port | `3000` |
| Healthcheck path | `/api/health` |

The port matters: Coolify proxies to it, and the container listens on 3000.

## 3. Environment variables

Under **Environment Variables**, add these five. None are build-time — leave
"Build Variable" unchecked for all of them.

| Variable | Value |
|---|---|
| `DATABASE_URL` | The internal URL from step 1 |
| `SESSION_SECRET` | A 32+ character random string (see below) |
| `INVITE_BOOTSTRAP_CODE` | Your own invite code, used once |
| `OFF_USER_AGENT` | `Eats/1.0 (john@johnste.se)` |
| `NODE_ENV` | `production` |

Generate a fresh secret rather than reusing one from chat:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`OFF_USER_AGENT` is not cosmetic — Open Food Facts rate-limits on it and asks
that it identify the app and a contact address.

## 4. Domain and TLS

Set a domain under **Domains** (e.g. `eats.yourdomain.tld`) and let Coolify
issue the certificate. **This step is required, not optional:** barcode
scanning calls `getUserMedia`, which browsers only allow in a secure context.
Over plain HTTP or a bare IP the scanner will refuse to start — the app detects
this and says so rather than failing silently, but it will not work.

## 5. Deploy, then check

Hit **Deploy** and watch the logs. On a successful first boot you should see
migrations apply and then `Server listening`.

Then verify, replacing the host:

```bash
curl -s https://eats.yourdomain.tld/api/health
```

Expect `{"ok":true}`. Then, in a browser:

- Load `/` — the app shell appears.
- Hard-refresh on `/weight` — it loads rather than 404ing. This is the static
  fallback working; if it fails, the SPA is not being served correctly.
- Register with your `INVITE_BOOTSTRAP_CODE`. It is accepted once and is inert
  afterwards, so there is no open registration left behind.
- Look for the install prompt, and add it to your home screen.
- **Scan a barcode.** This is the one thing that cannot be tested anywhere but
  a real phone on the real domain. iOS Safari is the likeliest to misbehave.

## 6. Backups

Coolify can schedule Postgres backups from the database service's **Backups**
tab. The food log is the whole point of the app and it only exists in that one
database — set this up before you have months of data worth losing.

---

## Notes

**Redeploys.** Pushing to `main` triggers a rebuild if you enable automatic
deployment. Migrations apply on boot, so schema changes ship with the code.

**The first account.** Registration always needs an invite.
`INVITE_BOOTSTRAP_CODE` seeds one code and only while no users exist — once you
register, that code stops working and further invites come from existing users.

**Scaling.** Sessions live in Postgres rather than in memory, so more than one
container replica would work. The OCR endpoint is CPU-heavy though, so vertical
sizing matters more than replicas.
