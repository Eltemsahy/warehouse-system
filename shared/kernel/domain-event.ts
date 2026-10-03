export interface DomainEvent<P = unknown> {
  id: string;
  name: string; // e.g. "inventory.StockAdjusted"
  occurredAt: Date;
  payload: P;
}
