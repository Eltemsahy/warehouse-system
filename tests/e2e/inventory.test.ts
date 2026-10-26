import { describe, expect, it } from "vitest";
import { InMemoryOutbox } from "../../shared/events/index.js";
import type { DomainEvent } from "../../shared/kernel/index.js";
import { createInventoryModule, InMemoryLedger } from "../../modules/inventory/index.js";

const WH = "00000000-0000-0000-0000-000000000001";
const OTHER_WH = "00000000-0000-0000-0000-000000000002";

describe("inventory", () => {
  const setup = () => createInventoryModule();

  it("adjusts stock and derives balance from the ledger", async () => {
    const inv = setup();
    await inv.adjust.execute({
      warehouseId: WH,
      sku: "SKU-1",
      locationId: "A-01",
      delta: 10,
      reason: "initial count",
    });
    expect(await inv.getBalance(WH, "SKU-1", "A-01")).toBe(10);
  });

  it("rejects negative balances", async () => {
    const inv = setup();
    const r = await inv.adjust.execute({
      warehouseId: WH,
      sku: "SKU-1",
      locationId: "A-01",
      delta: -1,
      reason: "oops",
    });
    expect(r.ok).toBe(false);
  });

  it("transfers stock between locations of one warehouse", async () => {
    const inv = setup();
    await inv.adjust.execute({
      warehouseId: WH,
      sku: "SKU-1",
      locationId: "A-01",
      delta: 10,
      reason: "init",
    });
    const r = await inv.transfer.execute({
      warehouseId: WH,
      sku: "SKU-1",
      from: "A-01",
      to: "B-02",
      quantity: 4,
    });
    expect(r.ok).toBe(true);
    expect(await inv.getBalance(WH, "SKU-1", "A-01")).toBe(6);
    expect(await inv.getBalance(WH, "SKU-1", "B-02")).toBe(4);
  });

  it("keeps two warehouses with the same location code apart", async () => {
    // Regression for G13: both warehouses have an "A-01".
    const inv = setup();
    await inv.adjust.execute({
      warehouseId: WH,
      sku: "SKU-1",
      locationId: "A-01",
      delta: 10,
      reason: "init",
    });
    await inv.adjust.execute({
      warehouseId: OTHER_WH,
      sku: "SKU-1",
      locationId: "A-01",
      delta: 3,
      reason: "init",
    });
    expect(await inv.getBalance(WH, "SKU-1", "A-01")).toBe(10);
    expect(await inv.getBalance(OTHER_WH, "SKU-1", "A-01")).toBe(3);

    const overdraw = await inv.adjust.execute({
      warehouseId: OTHER_WH,
      sku: "SKU-1",
      locationId: "A-01",
      delta: -5,
      reason: "needs more than this warehouse has",
    });
    expect(overdraw.ok).toBe(false);
    expect(await inv.getBalance(WH, "SKU-1", "A-01")).toBe(10);
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
      await inv.adjust.execute({
        warehouseId: WH,
        sku: "SKU-1",
        locationId: "A-01",
        delta: 10,
        reason: "init",
      });
      const [event] = await drain();
      expect(event?.name).toBe("inventory.StockAdjusted");
      expect((event?.payload as { warehouseId: string }).warehouseId).toBe(WH);
    });

    it("queues StockTransferred with its transferId and warehouse", async () => {
      const { inv, drain } = wired();
      await inv.adjust.execute({
        warehouseId: WH,
        sku: "SKU-1",
        locationId: "A-01",
        delta: 10,
        reason: "init",
      });
      await drain();
      const r = await inv.transfer.execute({
        warehouseId: WH,
        sku: "SKU-1",
        from: "A-01",
        to: "B-02",
        quantity: 4,
      });
      if (!r.ok) throw r.error;

      const [event] = await drain();
      expect(event?.name).toBe("inventory.StockTransferred");
      const payload = event?.payload as { transferId: string; warehouseId: string };
      expect(payload.transferId).toBe(r.value.transferId);
      expect(payload.warehouseId).toBe(WH);
    });

    it("queues nothing when the operation is rejected", async () => {
      const { inv, drain } = wired();
      const r = await inv.adjust.execute({
        warehouseId: WH,
        sku: "SKU-1",
        locationId: "A-01",
        delta: -1,
        reason: "oops",
      });
      expect(r.ok).toBe(false);
      expect(await drain()).toEqual([]);
    });
  });
});
