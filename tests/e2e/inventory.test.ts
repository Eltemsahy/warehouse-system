import { describe, expect, it } from "vitest";
import { InMemoryEventBus } from "../../shared/events/index.js";
import { createInventoryModule } from "../../modules/inventory/index.js";

describe("inventory", () => {
  const setup = () => createInventoryModule({ bus: new InMemoryEventBus() });

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
});
