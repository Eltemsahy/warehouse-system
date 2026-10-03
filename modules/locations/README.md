# locations module

Layers: `api/` (routes, DTOs) -> `application/` (use cases) -> `domain/` (rules, events) <- `infrastructure/` (DB, adapters).
Expose only what's needed through `index.ts`. Own schema: `locations`.
