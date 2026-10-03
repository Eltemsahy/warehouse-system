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

## Layout
`apps/` entrypoints, `modules/` domain modules (api > application > domain <- infrastructure), `shared/` kernel/events/observability, `integrations/` external adapters, `db/` migrations, `docs/` ADRs and glossary.

## Status
`inventory` is implemented with an in-memory ledger (Postgres ledger is next; schema is in `db/migrations`). Other modules are empty scaffolds.
