# Warehouse & Logistics Management System

Modular monolith (TypeScript, Express, Postgres). See `docs/adr/` for decisions.

## Quick start
```bash
cp .env.example .env
docker compose up -d db
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