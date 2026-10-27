# Warehouse & Logistics Management System

A modular monolith for warehouse and logistics operations, built with TypeScript, Express and PostgreSQL. Inventory is implemented today; inbound, outbound, shipping and the rest are planned.

## Contents

- [Overview](#overview)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Database setup](#database-setup)
- [Running the app](#running-the-app)
- [API](#api)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [Scripts](#scripts)
- [Testing](#testing)
- [Code quality](#code-quality)
- [Docker and deployment](#docker-and-deployment)
- [Git workflow](#git-workflow)
- [Troubleshooting](#troubleshooting)
- [Further reading](#further-reading)

## Overview

What exists today:

- **Inventory:** stock adjustments, transfers and balances, per warehouse, on an append-only movement ledger (see `docs/adr/0002-inventory-ledger.md` and `docs/adr/0004-tenancy-quantities-and-inventory-keys.md`).
- **Reliable events:** a transactional outbox delivers `inventory.StockAdjusted` and `inventory.StockTransferred` after commit, with retries and a dead-letter store.
- **Safe retries:** mutating requests accept an `Idempotency-Key`, so a retried request never writes twice.
- **Operations:** liveness and readiness endpoints, graceful shutdown, a nightly ledger integrity check, and a production Docker image that migrates before it serves.
- **Engineering:** module boundaries enforced by tooling, contract tests that run every adapter against the same suite, and CI that uses a real PostgreSQL.

What does not exist yet:

- **Authentication and authorisation.** Every route is open, so do not expose the API publicly yet.
- **The other modules.** `catalog`, `identity`, `inbound`, `locations`, `outbound` and `shipping` are empty scaffolds, as is `integrations/`.
- **A finished frontend.** `apps/web-admin` is in early development. It is linted and built by its own CI job, but it is not covered by the root Prettier setup. `apps/mobile-scanner` is a placeholder.

For the build status against the implementation plan, and the design decisions behind it, see `BACKEND_NOTES.txt`.

## Requirements

- Node.js 20.19 or newer (the frontend toolchain needs it; CI and the Docker image currently use Node 20)
- npm
- PostgreSQL 16 or newer, installed locally or run through Docker (Docker is optional)

## Quick start

```bash
npm install
cp .env.example .env     # on Windows: copy .env.example .env
```

Set up a database (see [Database setup](#database-setup)), then:

```bash
npm run migrate
npm run dev
```

Check that it is up:

```bash
curl localhost:3000/health/ready
```

You should get `{"status":"ready","checks":{"database":"ok"}}`. Then try the [API](#api). The frontend is a separate app, see [Running the app](#running-the-app).

## Configuration

Settings come from environment variables. Copy `.env.example` to `.env` and edit it: the API, the migration and ledger-check scripts, and the tests all load `.env` automatically (through `dotenv`). A variable that is already set in your shell wins over `.env`.

| Variable                    | Default                                 | Purpose                                                                 |
| --------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `PORT`                      | `3000`                                  | Port the API listens on                                                 |
| `DATABASE_URL`              | `postgres://wms:wms@localhost:5432/wms` | PostgreSQL connection string                                            |
| `LEDGER_DRIVER`             | `postgres`                              | `postgres` or `memory` (see [In-memory mode](#in-memory-mode))          |
| `LEDGER_INTEGRITY_HOUR_UTC` | `2`                                     | Hour (0 to 23, UTC) of the nightly ledger integrity check               |
| `LOG_LEVEL`                 | `info`                                  | `debug`, `info`, `warn` or `error`                                      |
| `RUN_MIGRATIONS`            | `true`                                  | Docker image only: set to `false` to skip migrations at container start |

## Database setup

The app needs a PostgreSQL database reachable through `DATABASE_URL`. Docker is **optional**: pick whichever option suits you.

### Option A: Docker (quickest)

Requires Docker Desktop (or the Docker engine) to be running.

```bash
docker compose up -d db
```

This starts Postgres 16 with user `wms`, password `wms` and database `wms` on port 5432, matching the defaults in `.env.example`.

### Option B: Local PostgreSQL (no Docker)

1. Install PostgreSQL (16 or newer).
2. Create the user and database the project expects, using `psql` or pgAdmin:

```sql
CREATE USER wms WITH PASSWORD 'wms';
CREATE DATABASE wms OWNER wms;
```

On Windows, `psql` is usually not on your PATH. Run it from `C:\Program Files\PostgreSQL\<version>\bin\psql.exe -U postgres`, or use pgAdmin's Query Tool.

3. If your Postgres runs on a different port or uses different credentials, change `DATABASE_URL` in `.env`, for example `postgres://wms:wms@localhost:5433/wms`.

### Apply the schema

With either option:

```bash
npm run migrate
```

The runner applies each file in `db/migrations/` once, in order, and records it (with a checksum) in `platform.schema_migrations`. Running it again is safe: applied files print `skipping`. It refuses to run if an applied file was edited, so to change the schema add a new numbered file instead.

## Running the app

### API

```bash
npm run dev
```

The API listens on http://localhost:3000 and restarts when you change a file. Stop it with Ctrl+C: it finishes in-flight requests before exiting.

### In-memory mode

To run without a database, use the in-memory ledger. Data lives only while the app runs, and the nightly integrity check and the database readiness check are not active.

```bash
LEDGER_DRIVER=memory npm run dev
```

```powershell
$env:LEDGER_DRIVER = "memory"
npm run dev
Remove-Item Env:LEDGER_DRIVER   # afterwards, so the setting does not stay for this session
```

### Production build

```bash
npm run build
npm run migrate:prod
npm start
```

### Frontend

`apps/web-admin` is a React + Vite app. It is an independent package with its own `package.json`, lockfile and toolchain (see `docs/adr/0003-independent-frontend-packages.md`), so it needs its own install. From the repo root:

```bash
npm run web:install
npm run web:dev     # usually http://localhost:5173
```

Or work inside the folder directly: `cd apps/web-admin`, then `npm install` and `npm run dev`.

## API

| Method | Path                                                                         | Purpose                                                                                 |
| ------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST` | `/inventory/warehouses/:warehouseId/adjustments`                             | Add or remove stock at a location                                                       |
| `POST` | `/inventory/warehouses/:warehouseId/transfers`                               | Move stock between two locations of the warehouse                                       |
| `GET`  | `/inventory/warehouses/:warehouseId/skus/:sku/locations/:locationId/balance` | Current balance at a location                                                           |
| `GET`  | `/health`                                                                    | Liveness: the process is up                                                             |
| `GET`  | `/health/ready`                                                              | Readiness: `200` when the database is reachable, `503` otherwise or while shutting down |

Inventory is scoped to a warehouse through the path (see `docs/adr/0004-tenancy-quantities-and-inventory-keys.md`). `warehouseId` is a UUID. A location code is unique within its warehouse, so two warehouses can both have an `A-01` and their stock stays separate. SKUs and location codes are exact-match, case-sensitive text of 1 to 64 characters: letters, digits, `.`, `_`, `/` and `-`. A transfer stays inside one warehouse.

Request bodies are JSON. The examples use `00000000-0000-0000-0000-000000000001`, the placeholder warehouse that migration 005 gave to any existing development data. Example requests (bash, then PowerShell):

```bash
WH=00000000-0000-0000-0000-000000000001

curl -X POST localhost:3000/inventory/warehouses/$WH/adjustments -H 'content-type: application/json' \
  -d '{"sku":"SKU-1","locationId":"A-01","delta":10,"reason":"initial count"}'

curl -X POST localhost:3000/inventory/warehouses/$WH/transfers -H 'content-type: application/json' \
  -d '{"sku":"SKU-1","from":"A-01","to":"B-02","quantity":4}'

curl localhost:3000/inventory/warehouses/$WH/skus/SKU-1/locations/A-01/balance
```

```powershell
$wh = "00000000-0000-0000-0000-000000000001"

$body = @{ sku="SKU-1"; locationId="A-01"; delta=10; reason="initial count" } | ConvertTo-Json
Invoke-RestMethod -Method Post http://localhost:3000/inventory/warehouses/$wh/adjustments -ContentType "application/json" -Body $body

$t = @{ sku="SKU-1"; from="A-01"; to="B-02"; quantity=4 } | ConvertTo-Json
Invoke-RestMethod -Method Post http://localhost:3000/inventory/warehouses/$wh/transfers -ContentType "application/json" -Body $t

Invoke-RestMethod http://localhost:3000/inventory/warehouses/$wh/skus/SKU-1/locations/A-01/balance   # expect 6
Invoke-RestMethod http://localhost:3000/inventory/warehouses/$wh/skus/SKU-1/locations/B-02/balance   # expect 4
```

An overdraw (for example `delta=-100`) returns `422` with an insufficient-stock error. PowerShell throws on any 4xx response, so that failure is the expected result.

### Idempotency keys

Send an `Idempotency-Key` header (1 to 255 printable characters, for example a UUID) on any `POST`, `PUT`, `PATCH` or `DELETE` so the request can be retried safely, for instance after a lost response on a flaky connection.

| Situation                             | Result                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| First request with a key              | Runs normally; its response is stored                                                          |
| Same key, same request                | The stored response is sent again with `Idempotent-Replayed: true`; nothing runs a second time |
| Same key, first request still running | `409` with `Retry-After: 1`                                                                    |
| Same key, different request           | `422`                                                                                          |
| No key                                | Runs normally (the header is optional for now)                                                 |

Keys are remembered for 24 hours. Successful responses and 4xx rejections are stored and replayed; a `5xx` is not, so the client can retry. A replay returns the stored status and JSON body.

```bash
curl -X POST localhost:3000/inventory/warehouses/$WH/adjustments -H 'content-type: application/json' \
  -H 'Idempotency-Key: demo-1' \
  -d '{"sku":"SKU-9","locationId":"A-01","delta":5,"reason":"idempotency demo"}'
# send it again: same response, Idempotent-Replayed: true, balance stays 5
```

### Errors

Errors are JSON of the form `{"error": "message"}`. A `400` caused by an invalid body returns the validation details instead.

| Status | Meaning                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | Invalid request body or path parameter (for example a `warehouseId` that is not a UUID), or an invalid `Idempotency-Key`         |
| `404`  | Unknown route                                                                                                                    |
| `409`  | The same `Idempotency-Key` is still being processed; retry shortly                                                               |
| `422`  | A business rule refused the request (for example insufficient stock), or an `Idempotency-Key` was reused for a different request |
| `500`  | Unexpected error; the details are in the server log, never in the response                                                       |
| `503`  | `/health/ready` only: not ready, or shutting down                                                                                |

## How it works

**Modular monolith.** One deployable and one database, with one Postgres schema per module (see `docs/adr/0001-modular-monolith.md`). Inside a module the layers are `api` to `application` to `domain`, with `infrastructure` implementing the domain's ports. Modules talk to each other only through their public `index.ts` or through domain events, and `npm run lint:deps` fails the build if that is broken. Only `apps/api/src/app.ts` wires modules together.

**Inventory ledger.** Every stock change is a row in `inventory.stock_movements`, which is never updated or deleted. Balances are cached in `inventory.stock_levels` and updated in the same transaction. Every key starts with the warehouse: a balance belongs to one `(warehouse, sku, location)`. A database constraint keeps balances from going negative, even under concurrent requests. A correction is a new movement, never an edit.

**Events and the outbox.** A use case hands its events to the ledger, which stores them in `platform.outbox` in the same transaction as the stock change. A relay then delivers them to subscribers. Delivery is at least once, so subscribers must be idempotent. A failed delivery is retried with growing delays, and after 8 failures the event moves to `platform.outbox_dead_letter`.

**Health and shutdown.** `/health` is liveness; `/health/ready` also checks the database. On SIGTERM or Ctrl+C the app reports not-ready, finishes in-flight requests, stops the relay and jobs, closes the database pool, and exits (forcing exit after 8 seconds).

**Ledger integrity check.** Every night at `LEDGER_INTEGRITY_HOUR_UTC` the app checks that, for every SKU and location, the sum of the ledger equals the cached balance. A mismatch is logged at error level. Run it by hand with `npm run check:ledger`. If it ever fails, do not edit `stock_levels`: find the cause from the movements and correct it with a new adjustment.

## Project layout

```text
apps/
  api/             Express API (composition root: src/app.ts, entry: src/main.ts)
  web-admin/       React + Vite frontend (independent package: own package.json and lockfile)
  mobile-scanner/  placeholder for the handheld/PWA picker app
modules/           one folder per domain module
  inventory/       implemented
  catalog/ identity/ inbound/ locations/ outbound/ shipping/   empty scaffolds
shared/
  kernel/          Result, ids, DomainEvent
  events/          in-process event bus, transactional outbox and relay
  http/            Idempotency-Key middleware and stores
  jobs/            daily job scheduler
  observability/   JSON logger
integrations/      external adapters (carriers, edi, erp), scaffolds
db/                migrations/, migrate.ts, check-ledger.ts, seeds/
docs/              ADRs and glossary
infra/             Dockerfile and container entrypoint
scripts/           build helpers
tests/             unit/, contract/, e2e/, helpers/
```

## Scripts

| Script                 | What it does                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `npm run dev`          | Starts the API with auto-restart (`tsx watch`)                                        |
| `npm run build`        | Compiles the API to `dist/` and copies the SQL migrations next to it                  |
| `npm start`            | Runs the compiled API (`dist/apps/api/src/main.js`)                                   |
| `npm run migrate`      | Applies pending migrations (development, via `tsx`)                                   |
| `npm run migrate:prod` | Applies pending migrations from the compiled build                                    |
| `npm run check:ledger` | Runs the ledger integrity check once (exit 0 consistent, 1 mismatch, 2 could not run) |
| `npm test`             | Runs all tests with Vitest                                                            |
| `npm run typecheck`    | Type-checks without emitting (`tsc --noEmit`)                                         |
| `npm run lint`         | ESLint                                                                                |
| `npm run lint:deps`    | Verifies module boundaries (dependency-cruiser)                                       |
| `npm run format`       | Formats the code with Prettier                                                        |
| `npm run format:check` | Fails if anything is not formatted (this is what CI runs)                             |
| `npm run web:install`  | Installs the frontend's dependencies (`apps/web-admin`)                               |
| `npm run web:dev`      | Starts the frontend dev server                                                        |
| `npm run web:build`    | Builds the frontend                                                                   |
| `npm run web:lint`     | Lints the frontend                                                                    |

## Testing

```bash
npm test
```

The suite has three layers:

- **Unit** (`tests/unit`): small pure pieces such as the scheduler and the shutdown routine.
- **Contract** (`tests/contract`): one shared suite per port (stock ledger, outbox, idempotency store) that every implementation must pass. The in-memory implementations always run; the PostgreSQL ones need a database.
- **End to end** (`tests/e2e`): the HTTP API, the inventory use cases and the ledger integrity check.

### Running the PostgreSQL tests

These run the same logic against a real database and cover what the in-memory versions cannot, such as transfers from an existing balance, concurrent withdrawals never overdrawing stock, and concurrent outbox relays never delivering an event twice.

1. Make sure Postgres is running and the schema is applied (`npm run migrate`).
2. Set `LEDGER_DRIVER=postgres`, in your shell or in `.env`. `DATABASE_URL` comes from `.env` or your shell, and the tests do not fall back to a default.

```bash
LEDGER_DRIVER=postgres npm test
```

```powershell
$env:LEDGER_DRIVER = "postgres"
npm test
```

Notes:

- Each run uses unique SKUs and keys and leaves its rows behind, so use a development database, never one with real data.
- If your `.env` sets `LEDGER_DRIVER=postgres`, the PostgreSQL tests run on every `npm test`.
- After a PostgreSQL run, `npm run check:ledger` should still report a consistent ledger. CI does exactly that.

### Continuous integration

CI (`.github/workflows/ci.yml`) runs four jobs in parallel, and any failure fails the run:

- **quality:** Prettier check, ESLint, type-check, module boundaries and the production build.
- **test:** all tests against a PostgreSQL 16 service, then the ledger integrity check.
- **image:** builds the Docker image, starts it against PostgreSQL, checks it migrated and became ready, and checks that `docker stop` exits cleanly.
- **web-admin:** installs the frontend on its own, then lints and builds it.

## Code quality

- **Prettier** sets the style (`.prettierrc`: double quotes, semicolons, trailing commas, 100 columns). A pre-commit hook formats staged files automatically; run `npm run format` to format the whole repository. CI runs `npm run format:check`.
- **ESLint** (`npm run lint`) catches likely bugs and enforces `import type` for type-only imports.
- **dependency-cruiser** (`npm run lint:deps`) enforces the module boundaries and layering.
- **TypeScript** runs in strict mode (`npm run typecheck`).
- **Line endings** are LF everywhere (`.gitattributes`). On Windows this keeps `prettier --check` consistent with CI.

`apps/web-admin` is an independent package with its own toolchain. It has its own ESLint config and its own CI job (`npm run web:lint`, `npm run web:build`), and it is excluded from the root ESLint and Prettier.

## Docker and deployment

To run only the database in Docker (as in [Database setup](#database-setup)):

```bash
docker compose up -d db
```

To run the whole stack, database and production image together:

```bash
docker compose --profile app up --build
```

The API is then on http://localhost:3000.

The production image (`infra/Dockerfile`) is multi-stage, runs as a non-root user and has a healthcheck on `/health/ready`. On start it applies pending migrations and then serves, so a plain `docker run` works. Several containers starting together are safe, because the migration runner takes a database lock.

```bash
docker build -f infra/Dockerfile -t wms-api .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgres://wms:wms@host.docker.internal:5432/wms \
  -e LEDGER_DRIVER=postgres \
  wms-api
```

`host.docker.internal` reaches a database on your own machine from Docker Desktop. On Linux, add `--add-host=host.docker.internal:host-gateway`.

If you prefer to migrate as a separate release step, skip it at start and run it on its own:

```bash
docker run --rm -e RUN_MIGRATIONS=false -e DATABASE_URL=... wms-api node dist/db/migrate.js
```

Before deploying anywhere public:

- Set `DATABASE_URL` and `PORT` on the host. Never commit `.env`.
- Hosted PostgreSQL usually requires SSL: add `?sslmode=require` to `DATABASE_URL`.
- Point your platform's liveness probe at `/health` and its readiness probe at `/health/ready`.
- Add authentication first: the API has none yet.

## Git workflow

We use two long-lived branches:

| Branch    | Purpose                                 | Who pushes                     |
| --------- | --------------------------------------- | ------------------------------ |
| `staging` | Day-to-day work and integration testing | Everyone                       |
| `main`    | Verified, stable code only              | Promotions from `staging` only |

`main` never receives untested code, so it rarely needs to be reverted.

### Daily work (on `staging`)

```bash
git checkout staging
git pull                      # always pull before you start
# ...make your changes...
npm run format                # CI fails on unformatted code
npm run lint && npm run typecheck && npm run lint:deps && npm test
git add .
git commit -m "feat(inventory): added short description"
git push
```

CI runs on every push. If it goes red, fix it before doing anything else, since a broken `staging` blocks everyone.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) with one twist: **a single line, in the past tense**. The format is `type(scope): what changed`.

| Type       | Use for                                  |
| ---------- | ---------------------------------------- |
| `feat`     | A new feature                            |
| `fix`      | A bug fix                                |
| `refactor` | Code change that is not a feature or fix |
| `test`     | Adding or changing tests                 |
| `docs`     | Documentation only                       |
| `style`    | Formatting only, no behaviour change     |
| `ci`       | CI configuration                         |
| `chore`    | Tooling, dependencies, config            |

The scope is usually the module name, for example `feat(inventory): added Postgres stock ledger`. Keep the message to one line; put the reasoning in the pull request description.

### Releasing to `main`

When `staging` has been tested and is stable:

```bash
git checkout main
git pull
git merge --ff-only staging   # fast-forward; refuses to run if main has diverged
git push
```

If you want a review step, open a pull request from `staging` to `main` and merge it with a **merge commit** (not squash, which would make the two branches diverge).

Before promoting, check that:

- CI is green on `staging` (all four jobs)
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run lint:deps`, `npm run build` and `npm test` pass locally (and `npm run web:build` if you touched the frontend)
- For database changes: `npm run migrate && LEDGER_DRIVER=postgres npm test && npm run check:ledger`

### Rules

1. **Never push directly to `main`.** Only promote from `staging`.
2. **Pull before you push**, and keep commits small: one logical change each.
3. **Don't rewrite `staging` history.** No force-push once others have pulled it.
4. **Use a short-lived branch for risky work** (large refactors, schema-wide changes). Branch from `staging`, open a PR back into `staging`, and delete the branch after merging.
5. **Never edit a migration that has been merged.** Add a new numbered file in `db/migrations/` instead. The runner refuses a changed file.

### Undoing a change

Use `git revert`, which adds a new commit and keeps history intact:

```bash
git revert <commit-sha>       # a normal commit
git revert -m 1 <merge-sha>   # a merge commit
git push
```

### Recommended GitHub settings

- Protect `main`: require the `quality`, `test`, `image` and `web-admin` checks to pass and block direct pushes.
- Keep `staging` unprotected enough that the team can push, but require CI to pass on it as a convention.

## Troubleshooting

- **`password authentication failed for user "wms"`:** something else is listening on port 5432 (often a local Postgres without the `wms` user), or the credentials do not match. Create the user as in [Option B](#option-b-local-postgresql-no-docker), or change the port and `DATABASE_URL`. To see what owns the port on Windows: `netstat -ano | findstr :5432`.
- **`failed to connect to the docker API`:** Docker Desktop is not running. Start it and wait for "Engine running", or use Option B and skip Docker.
- **`psql` is not recognized (Windows):** it is not on your PATH. Run it by its full path (see Option B) or use pgAdmin's Query Tool.
- **`client password must be a string` in tests or scripts:** `DATABASE_URL` is not set. Check that `.env` exists and contains it.
- **`Cannot find module 'react'` (or `vite`) when working on the frontend:** the frontend no longer shares the root's `node_modules`. Run `npm run web:install`.
- **`/health/ready` returns `503`:** the database is unreachable, or the app is shutting down. The server log says which check failed.
- **A request keeps returning `409`:** an earlier request with the same `Idempotency-Key` is still marked in progress, which can happen if the app was killed mid-request. Use a new key, or see `BACKEND_NOTES.txt` (Idempotency) for how to clear it safely.
- **`prettier --check` fails on every file (Windows):** line endings. Run `git add --renormalize .` and then `npm run format`.

## Further reading

- `docs/adr/`: architecture decisions (modular monolith, inventory ledger, independent frontend packages, tenancy and inventory keys)
- `docs/domain/glossary.md`: warehouse terms used in the code
- `BACKEND_NOTES.txt`: build status against the implementation plan, conventions and known limits`
