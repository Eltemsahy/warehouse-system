# Warehouse & Logistics Management System

Modular monolith (TypeScript, Express, Postgres). See `docs/adr/` for decisions.

## Quick start
```bash
cp .env.example .env

## Database setup

The app needs a PostgreSQL database reachable via `DATABASE_URL`. Docker is **optional**: pick whichever option suits you.

### Option A: Docker (quickest)

Requires Docker Desktop (or the Docker engine) to be running.

```bash
docker compose up -d db
```

This starts Postgres 16 with user `wms`, password `wms`, and database `wms` on port 5432, matching the defaults in `.env.example`.

### Option B: Local PostgreSQL (no Docker)

1. Install PostgreSQL (16 or newer).
2. Create the user and database the project expects, using `psql` or pgAdmin:

```sql
CREATE USER wms WITH PASSWORD 'wms';
CREATE DATABASE wms OWNER wms;
```

On Windows, `psql` is usually not on your PATH. Run it from `C:\Program Files\PostgreSQL\<version>\bin\psql.exe -U postgres`, or use pgAdmin's Query Tool.

3. If your Postgres runs on a different port or uses different credentials, set `DATABASE_URL` accordingly:

```bash
# macOS/Linux
export DATABASE_URL=postgres://wms:wms@localhost:5433/wms
```
```powershell
# PowerShell
$env:DATABASE_URL="postgres://wms:wms@localhost:5433/wms"
```

### Apply the schema

With either option:

```bash
npm run migrate
```

> If you see `password authentication failed for user "wms"`, something else is already listening on port 5432 (often a local Postgres without the `wms` user) or the credentials don't match. Create the user as in Option B, or change the port mapping in `docker-compose.yml` and `DATABASE_URL`.

npm install
npm run migrate
npm run dev          # http://localhost:3000/health

npm test
npm run lint:deps    # verifies module boundaries

cd apps/web-admin
npm install
npm run dev          # start the frontend
```

## Try it
```bash
curl -X POST localhost:3000/inventory/adjustments -H 'content-type: application/json' \
  -d '{"sku":"SKU-1","locationId":"A-01","delta":10,"reason":"initial count"}'
curl localhost:3000/inventory/SKU-1/locations/A-01/balance
```

## Inventory storage
The inventory ledger uses PostgreSQL by default. To use temporary in-memory storage instead, set `LEDGER_DRIVER` in PowerShell before starting the app:
```powershell

$env:LEDGER_DRIVER = "memory"
npm run dev

```
In-memory data is kept only while the app is running. The app reads environment variables directly; it does not automatically load values from `.env`.

## Layout
`apps/` entrypoints, `modules/` domain modules (api > application > domain <- infrastructure), `shared/` kernel/events/observability, `integrations/` external adapters, `db/` migrations, `docs/` ADRs and glossary.

## Status
`inventory` supports in-memory and PostgreSQL ledgers. Other modules are empty scaffolds.


## Git workflow

We use two long-lived branches:

| Branch    | Purpose                                              | Who pushes                         |
|-----------|------------------------------------------------------|------------------------------------|
| `staging` | Day-to-day work and integration testing              | Everyone                           |
| `main`    | Verified, stable code only                           | Promotions from `staging` only     |

`main` never receives untested code, so it rarely needs to be reverted.

### Daily work (on `staging`)

```bash
git checkout staging
git pull                      # always pull before you start
# ...make your changes...
npm run typecheck && npm run lint:deps && npm test
git add .
git commit -m "feat(inventory): short description"
git push
```

CI runs on every push. If it goes red, fix it before doing anything else, since a broken `staging` blocks everyone.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, in the imperative mood, under about 72 characters.

| Type       | Use for                                   |
|------------|-------------------------------------------|
| `feat`     | A new feature                             |
| `fix`      | A bug fix                                 |
| `refactor` | Code change that isn't a feature or fix   |
| `test`     | Adding or changing tests                  |
| `docs`     | Documentation only                        |
| `chore`    | Tooling, dependencies, config             |

The scope is usually the module name, e.g. `feat(inventory): add Postgres stock ledger`. Use the body to explain *why*, not to repeat the diff.

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

- CI is green on `staging`
- `npm run typecheck`, `npm run lint:deps` and `npm test` pass locally
- For database changes: `docker compose up -d db && npm run migrate && LEDGER_DRIVER=postgres npm test`

### Rules

1. **Never push directly to `main`.** Only promote from `staging`.
2. **Pull before you push**, and keep commits small: one logical change each.
3. **Don't rewrite `staging` history.** No force-push once others have pulled it.
4. **Use a short-lived branch for risky work** (large refactors, schema-wide changes). Branch from `staging`, open a PR back into `staging`, and delete the branch after merging.
5. **Never edit a migration that has been merged.** Add a new numbered file in `db/migrations/` instead.

### Undoing a change

Use `git revert`, which adds a new commit and keeps history intact:

```bash
git revert <commit-sha>       # a normal commit
git revert -m 1 <merge-sha>   # a merge commit
git push
```

### Recommended GitHub settings

- Protect `main`: require the CI check to pass and block direct pushes.
- Keep `staging` unprotected enough that the team can push, but require CI to pass on it as a convention.

## Testing

### Unit and e2e tests (no database needed)

```bash
npm test
```

Runs the in-memory suite (`tests/e2e/inventory.test.ts`). The Postgres tests below are skipped by default.

### Postgres ledger tests

These run the same inventory logic against a real database and cover things the in-memory ledger can't, such as transfers from an existing balance and concurrent withdrawals never overdrawing stock.

1. Make sure Postgres is running and the schema is applied:

```bash
npm run migrate
```

2. Enable the tests and point them at your database.

PowerShell:

```powershell
$env:LEDGER_DRIVER="postgres"
$env:DATABASE_URL="postgres://wms:wms@localhost:5432/wms"
npm test
```

macOS/Linux:

```bash
LEDGER_DRIVER=postgres DATABASE_URL=postgres://wms:wms@localhost:5432/wms npm test
```

Both variables are required. The tests build their own connection pool and don't fall back to a default URL.

Notes:

- Each run uses unique SKUs and leaves its rows behind, so use a dev database, never one with real data.
- CI skips these tests unless a Postgres service container is added, `npm run migrate` is run, and both variables are set.

### Manual API check

With the API running (`npm run dev`):

```powershell
$body = @{ sku="SKU-1"; locationId="A-01"; delta=10; reason="initial count" } | ConvertTo-Json
Invoke-RestMethod -Method Post http://localhost:3000/inventory/adjustments -ContentType "application/json" -Body $body

$t = @{ sku="SKU-1"; from="A-01"; to="B-02"; quantity=4 } | ConvertTo-Json
Invoke-RestMethod -Method Post http://localhost:3000/inventory/transfers -ContentType "application/json" -Body $t

Invoke-RestMethod http://localhost:3000/inventory/SKU-1/locations/A-01/balance   # expect 6
Invoke-RestMethod http://localhost:3000/inventory/SKU-1/locations/B-02/balance   # expect 4
```

An overdraw (for example `delta=-100`) should return `422` with an insufficient-stock error.