# ADR 0001: Modular monolith organised by domain

- **Status:** Accepted
- **Context:** WMS domains (inventory, orders, picking, shipping) are tightly coupled by transactions. Stock moves must be atomic.
- **Decision:** One deployable, one database, one schema per module. Modules interact via public `index.ts` interfaces or domain events. Boundaries enforced with dependency-cruiser.
- **Consequences:** Simple transactions and ops now; any module can be extracted later along its existing boundary.
