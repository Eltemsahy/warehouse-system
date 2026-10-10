import { describe, expect, it } from "vitest";
import { InMemoryOutbox } from "../../shared/events/index.js";
import type { DomainEvent } from "../../shared/kernel/index.js";
import { createInventoryModule, InMemoryLedger } from "../../modules/inventory/index.js";

describe("inventory", () => {
  const setup = () => createInventoryModule();

  it("adjusts stock and derives balance from the ledger", async () => {
    const inv = setup();
    await inv.adjust.execute({ sku: "SKU-1", locationId: "A-01", delta: 10, reason: "initial count" });
    expect(await inv.getBalance("SKU-1", "A-01")).toBe(10);
  });

  it("rejects negative balances", async () => {
    const inv = setup();
    const r = await inv.adjust.execute({ sku: "SKU-1", locationId: "A-01", delta: -1, reason: "oops" });
    expect(r.ok).toBe(false);
  });

  it("transfers stock between locations", async () => {
    const inv = setup();
    await inv.adjust.execute({ sku: "SKU-1", locationId: "A-01", delta: 10, reason: "init" });
    const r = await inv.transfer.execute({ sku: "SKU-1", from: "A-01", to: "B-02", quantity: 4 });
    expect(r.ok).toBe(true);
    expect(await inv.getBalance("SKU-1", "A-01")).toBe(6);
    expect(await inv.getBalance("SKU-1", "B-02")).toBe(4);
  });

  describe("events", () => {
    const wired = () => {
      const outbox = new InMemoryOutbox();
      const inv = createInventoryModule({ ledger: new InMemoryLedger(outbox) });
      const drain = async () => {
        const seen: DomainEvent[] = [];
        await outbox.dispatch(
          (e) => {
            seen.push(e);
          },
          { limit: 100, maxAttempts: 3, backoffMs: () => 0 },
        );
        return seen;
      };
      return { inv, drain };
    };

    it("queues StockAdjusted together with the adjustment", async () => {
      const { inv, drain } = wired();
      await inv.adjust.execute({ sku: "SKU-1", locationId: "A-01", delta: 10, reason: "init" });
      expect((await drain()).map((e) => e.name)).toEqual(["inventory.StockAdjusted"]);
    });

    it("queues StockTransferred with its transferId", async () => {
      const { inv, drain } = wired();
      await inv.adjust.execute({ sku: "SKU-1", locationId: "A-01", delta: 10, reason: "init" });
      await drain();
      const r = await inv.transfer.execute({ sku: "SKU-1", from: "A-01", to: "B-02", quantity: 4 });
      if (!r.ok) throw r.error;

      const [event] = await drain();
      expect(event?.name).toBe("inventory.StockTransferred");
      expect((event?.payload as { transferId: string }).transferId).toBe(r.value.transferId);
    });

    it("queues nothing when the operation is rejected", async () => {
      const { inv, drain } = wired();
      const r = await inv.adjust.execute({ sku: "SKU-1", locationId: "A-01", delta: -1, reason: "oops" });
      expect(r.ok).toBe(false);
      expect(await drain()).toEqual([]);
    });
  });
});