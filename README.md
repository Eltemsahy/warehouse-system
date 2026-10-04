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
