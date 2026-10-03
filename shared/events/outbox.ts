import type { DomainEvent } from "../kernel/index.js";

/**
 * Outbox: events are stored in the SAME transaction as the state change,
 * then a relay publishes them (ERP, carriers, e-commerce).
 */
export interface OutboxStore {
  add(events: DomainEvent[]): Promise<void>;
  pending(limit: number): Promise<DomainEvent[]>;
  markPublished(ids: string[]): Promise<void>;
}

export class InMemoryOutbox implements OutboxStore {
  private rows: { event: DomainEvent; published: boolean }[] = [];
  async add(events: DomainEvent[]) { this.rows.push(...events.map((event) => ({ event, published: false }))); }
  async pending(limit: number) { return this.rows.filter((r) => !r.published).slice(0, limit).map((r) => r.event); }
  async markPublished(ids: string[]) { this.rows.forEach((r) => { if (ids.includes(r.event.id)) r.published = true; }); }
}
