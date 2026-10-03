import type { DomainEvent } from "../kernel/index.js";

export type EventHandler = (event: DomainEvent) => Promise<void> | void;

/** In-process bus. Swap for a broker later without changing publishers. */
export class InMemoryEventBus {
  private handlers = new Map<string, EventHandler[]>();

  subscribe(eventName: string, handler: EventHandler): void {
    this.handlers.set(eventName, [...(this.handlers.get(eventName) ?? []), handler]);
  }

  async publish(events: DomainEvent[]): Promise<void> {
    for (const e of events) {
      for (const h of this.handlers.get(e.name) ?? []) await h(e);
    }
  }
}
