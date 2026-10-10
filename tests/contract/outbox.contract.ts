import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StockLedger } from "../../modules/inventory/application/ports.js";
import { InsufficientStockError } from "../../modules/inventory/domain/errors.js";
import { createMovement } from "../../modules/inventory/domain/stock-movement.js";
import type {
  DispatchOptions,
  EventHandler,
  OutboxDispatcher,
  OutboxInspector,
} from "../../shared/events/index.js";
import type { DomainEvent } from "../../shared/kernel/index.js";

/** A ledger and the outbox it writes to, backed by the same store. */
export interface OutboxHarness {
  ledger: StockLedger;
  outbox: OutboxDispatcher & OutboxInspector;
}

const options = (over: Partial<DispatchOptions> = {}): DispatchOptions => ({
  limit: 500,
  maxAttempts: 3,
  backoffMs: () => 0,
  ...over,
});

const probe = (): DomainEvent => ({
  id: randomUUID(),
  name: "test.OutboxProbed",
  occurredAt: new Date(),
  payload: { probe: true },
});

const deposit = (sku = `SKU-${randomUUID()}`) =>
  createMovement({ sku, locationId: "A-01", quantityDelta: 1, type: "ADJUSTMENT" });

/**
 * Dispatches until none of `ids` is pending any more. Other events may be in the outbox
 * (left by earlier runs), so handlers in these tests only react to their own ids.
 */
async function settle(
  { outbox }: OutboxHarness,
  ids: string[],
  handler: EventHandler,
  opts = options(),
) {
  for (let pass = 0; pass < 100; pass++) {
    const statuses = await Promise.all(ids.map((id) => outbox.status(id)));
    if (statuses.every((s) => s !== "pending")) return;
    await outbox.dispatch(handler, opts);
  }
  throw new Error("outbox did not settle");
}

/**
 * The transactional outbox contract (TRD s5.4, Implementation Plan P0-5). Every pair of
 * ledger + dispatcher must pass this exact suite.
 */
export function outboxContract(
  name: string,
  factory: () => OutboxHarness,
  opts: { skip?: boolean } = {},
) {
  const suite = opts.skip ? describe.skip : describe;

  suite(`Outbox contract: ${name}`, () => {
    it("stores events together with the movements", async () => {
      const { ledger, outbox } = factory();
      const sku = `SKU-${randomUUID()}`;
      const event = probe();
      await ledger.append([deposit(sku)], [event]);
      expect(await outbox.status(event.id)).toBe("pending");
      expect(await ledger.balance(sku, "A-01")).toBe(1);
    });

    it("stores no event when the append is rejected", async () => {
      const { ledger, outbox } = factory();
      const event = probe();
      const overdraw = createMovement({
        sku: `SKU-${randomUUID()}`,
        locationId: "A-01",
        quantityDelta: -1,
        type: "ISSUE",
      });
      await expect(ledger.append([overdraw], [event])).rejects.toBeInstanceOf(
        InsufficientStockError,
      );
      expect(await outbox.status(event.id)).toBe("missing");
    });

    it("delivers a committed event exactly once and marks it published", async () => {
      const h = factory();
      const event = probe();
      const delivered: string[] = [];
      const handler: EventHandler = (e) => {
        if (e.id === event.id) delivered.push(e.id);
      };
      await h.ledger.append([deposit()], [event]);

      await settle(h, [event.id], handler);
      await h.outbox.dispatch(handler, options()); // must not deliver it again

      expect(delivered).toEqual([event.id]);
      expect(await h.outbox.status(event.id)).toBe("published");
    });

    it("retries a failed delivery", async () => {
      const h = factory();
      const event = probe();
      let calls = 0;
      const handler: EventHandler = (e) => {
        if (e.id !== event.id) return;
        calls += 1;
        if (calls === 1) throw new Error("subscriber down");
      };
      await h.ledger.append([deposit()], [event]);

      await settle(h, [event.id], handler);

      expect(calls).toBe(2);
      expect(await h.outbox.status(event.id)).toBe("published");
    });

    it("dead-letters an event after maxAttempts failures", async () => {
      const h = factory();
      const event = probe();
      let calls = 0;
      const handler: EventHandler = (e) => {
        if (e.id !== event.id) return;
        calls += 1;
        throw new Error("always failing");
      };
      await h.ledger.append([deposit()], [event]);

      await settle(h, [event.id], handler, options({ maxAttempts: 3 }));
      await h.outbox.dispatch(handler, options({ maxAttempts: 3 }));

      expect(calls).toBe(3);
      expect(await h.outbox.status(event.id)).toBe("dead");
    });

    it("does not let a failing event block the others in the batch", async () => {
      const h = factory();
      const bad = probe();
      const good = probe();
      const handler: EventHandler = (e) => {
        if (e.id === bad.id) throw new Error("poison event");
      };
      await h.ledger.append([deposit()], [bad]);
      await h.ledger.append([deposit()], [good]);

      await settle(h, [good.id], handler);

      expect(await h.outbox.status(good.id)).toBe("published");
      expect(await h.outbox.status(bad.id)).not.toBe("published");
    });

    it("never delivers the same event to concurrent dispatchers twice", async () => {
      const h = factory();
      const events = Array.from({ length: 10 }, probe);
      for (const e of events) await h.ledger.append([deposit()], [e]);

      const mine = new Set(events.map((e) => e.id));
      const counts = new Map<string, number>();
      const handler: EventHandler = async (e) => {
        if (!mine.has(e.id)) return;
        await new Promise((resolve) => setTimeout(resolve, 5)); // widen the race window
        counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
      };

      // Small batches so the three dispatchers genuinely compete for rows.
      const small = options({ limit: 4 });
      await Promise.all([
        h.outbox.dispatch(handler, small),
        h.outbox.dispatch(handler, small),
        h.outbox.dispatch(handler, small),
      ]);
      await settle(h, [...mine], handler);

      for (const e of events) expect(counts.get(e.id)).toBe(1);
    });
  });
}