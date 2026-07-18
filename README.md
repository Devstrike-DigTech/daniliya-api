# Daniliya API

The single backend for the Daniliya platform — one NestJS API serving all five
frontends (`daniliya-web`, `-affiliate`, `-influencer`, `-vendor`, `-admin`).

**Stack:** NestJS 11 · Prisma 7 · PostgreSQL · Redis · JWT (access + refresh) ·
Paystack/Flutterwave · Smile ID · Resend/Termii · Cloudinary/S3.

Design docs (architecture, ERD, endpoints, business rules, delivery plan) live in
[`docs/`](./docs/README.md).

---

## Running locally

**Prerequisites:** Node 20+, Docker running.

```bash
npm install                              # first time only
docker compose up -d postgres redis      # Postgres :5435, Redis :6381
npx prisma migrate deploy                # apply migrations
npx prisma generate                      # generate the Prisma client
npm run start:dev                        # API on :4000 (watch mode)
```

Seed reference data (tutorial lessons, assessment questions, catalogue,
service verticals) — safe to re-run:

```bash
npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node"}' prisma/seed.ts
```

### Where things run

| What | URL / port |
|---|---|
| **API base** | `http://localhost:4000/api/v1` |
| **Swagger UI** | `http://localhost:4000/api/docs` |
| OpenAPI JSON | `http://localhost:4000/api/docs-json` |
| Health check | `http://localhost:4000/api/v1/health` |
| Postgres | `localhost:5435` (`daniliya` / `daniliya` / `daniliya_dev`) |
| Redis | `localhost:6381` |

> Ports 5435/6381 are deliberate — 5432/5433/6379 were already taken by other
> projects on this machine. Change them in `docker-compose.yml` + `.env` together.

Everything in one container instead: `docker compose up` (also starts the API).

### Scripts

| Command | Does |
|---|---|
| `npm run start:dev` | Watch mode (what you usually want) |
| `npm run build` + `npm run start:prod` | Production build + run |
| `npm run lint` / `npm run test` | ESLint / Jest |

---

## First admin login

On boot the API seeds a **SUPERADMIN** from `ADMIN_EMAIL` (see `.env`). It has no
usable password — set one via `POST /api/v1/auth/forgot-password`, then
`/auth/reset-password` (the token is emailed; without a Resend key it's printed
in the server log as `[dev-mail]`).

## Environment

`.env.example` is the contract — copy it to `.env` and fill in. Only `DATABASE_URL`,
`REDIS_URL`, `CORS_ORIGIN` and the two `JWT_*` secrets are required to boot;
integration keys (Paystack, Resend, Smile ID, …) are optional and degrade
gracefully in development:

- **No Resend key** → emails (OTPs, resets) are logged to the console.
- **No/placeholder Paystack key** → payments and transfers are *simulated*;
  webhook signature verification still runs for real.

`CORS_ORIGIN` is a **comma-separated list** — it must include every portal origin:

```
CORS_ORIGIN=http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:3004
```

| Portal | Port |
|---|---|
| `daniliya-web` | 3000 |
| `daniliya-affiliate` | 3001 |
| `daniliya-influencer` | 3002 |
| `daniliya-vendor` | 3003 |
| `daniliya-admin` | 3004 |

## Migrations

`prisma migrate dev` is interactive and fails in non-interactive shells. To create
a migration non-interactively:

```bash
DIR="prisma/migrations/$(date +%Y%m%d%H%M%S)_my_change" && mkdir -p "$DIR" && \
npx prisma migrate diff --from-config-datasource prisma.config.ts \
  --to-schema prisma/schema.prisma --script > "$DIR/migration.sql" && \
npx prisma migrate deploy && npx prisma generate
```

> **Gotcha:** any new `.ts` file outside `src/` (e.g. `prisma/seed.ts`) pulls the
> TypeScript rootDir up and makes the build emit `dist/src/main.js` instead of
> `dist/main.js`, which breaks `start:prod` and the Docker `CMD`. Such files must
> be listed in `tsconfig.build.json`'s `exclude`.

## Deployment

Deployed on Railway from the `Dockerfile` (`CMD` runs `prisma migrate deploy`
then `node dist/main`). Railway injects `DATABASE_URL`, `REDIS_URL` and `PORT`
when you add its Postgres and Redis plugins — set the remaining keys as service
variables. Swagger is disabled when `NODE_ENV=production`.
