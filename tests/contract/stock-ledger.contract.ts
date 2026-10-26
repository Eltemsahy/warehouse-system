import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StockLedger } from "../../modules/inventory/application/ports.js";
import { InsufficientStockError } from "../../modules/inventory/domain/errors.js";
import {
  createMovement,
  type MovementType,
} from "../../modules/inventory/domain/stock-movement.js";

type LedgerFactory = () => StockLedger | Promise<StockLedger>;

// Unique per test so adapters backed by a persistent database never collide.
const uniqueSku = () => `SKU-${randomUUID()}`;
const newWarehouse = () => randomUUID();

const move = (
  warehouseId: string,
  sku: string,
  locationId: string,
  delta: number,
  type: MovementType = "ADJUSTMENT",
) => createMovement({ warehouseId, sku, locationId, quantityDelta: delta, type });

/**
 * The StockLedger port contract (TRD s5, ADR 0002, ADR 0004). Every adapter must pass this
 * exact suite: append is atomic, no append may drive a balance below zero, and every balance
 * belongs to one warehouse.
 */
export function stockLedgerContract(
  name: string,
  factory: LedgerFactory,
  opts: { skip?: boolean } = {},
) {
  const suite = opts.skip ? describe.skip : describe;

  suite(`StockLedger contract: ${name}`, () => {
    it("returns 0 for an unknown warehouse/sku/location", async () => {
      const ledger = await factory();
      expect(await ledger.balance(newWarehouse(), uniqueSku(), "A-01")).toBe(0);
    });

    it("derives the balance from appended movements", async () => {
      const ledger = await factory();
      const [w, sku] = [newWarehouse(), uniqueSku()];
      await ledger.append([move(w, sku, "A-01", 10)]);
      await ledger.append([move(w, sku, "A-01", -3, "ISSUE")]);
      expect(await ledger.balance(w, sku, "A-01")).toBe(7);
    });

    it("keeps balances separate per sku and location", async () => {
      const ledger = await factory();
      const [w, sku, other] = [newWarehouse(), uniqueSku(), uniqueSku()];
      await ledger.append([
        move(w, sku, "A-01", 5),
        move(w, sku, "B-02", 8),
        move(w, other, "A-01", 2),
      ]);
      expect(await ledger.balance(w, sku, "A-01")).toBe(5);
      expect(await ledger.balance(w, sku, "B-02")).toBe(8);
      expect(await ledger.balance(w, other, "A-01")).toBe(2);
    });

    it("keeps the same sku and location code in two warehouses apart", async () => {
      // Regression for G13: both warehouses have an "A-01"; their stock must not merge.
      const ledger = await factory();
      const [w1, w2, sku] = [newWarehouse(), newWarehouse(), uniqueSku()];
      await ledger.append([move(w1, sku, "A-01", 10), move(w2, sku, "A-01", 4)]);
      expect(await ledger.balance(w1, sku, "A-01")).toBe(10);
      expect(await ledger.balance(w2, sku, "A-01")).toBe(4);
    });

    it("does not let one warehouse's stock cover another warehouse's withdrawal", async () => {
      const ledger = await factory();
      const [w1, w2, sku] = [newWarehouse(), newWarehouse(), uniqueSku()];
      await ledger.append([move(w1, sku, "A-01", 10)]);
      await expect(ledger.append([move(w2, sku, "A-01", -1, "ISSUE")])).rejects.toBeInstanceOf(
        InsufficientStockError,
      );
      expect(await ledger.balance(w1, sku, "A-01")).toBe(10);
      expect(await ledger.balance(w2, sku, "A-01")).toBe(0);
    });

    it("applies a negative movement against an existing balance", async () => {
      // Regression: the Postgres upsert used to reject any negative delta.
      const ledger = await factory();
      const [w, sku] = [newWarehouse(), uniqueSku()];
      await ledger.append([move(w, sku, "A-01", 10)]);
      await ledger.append([move(w, sku, "A-01", -4, "ISSUE")]);
      expect(await ledger.balance(w, sku, "A-01")).toBe(6);
    });

    it("rejects a negative first movement when no balance exists", async () => {
      const ledger = await factory();
      const [w, sku] = [newWarehouse(), uniqueSku()];
      await expect(ledger.append([move(w, sku, "A-01", -1, "ISSUE")])).rejects.toBeInstanceOf(
        InsufficientStockError,
      );
      expect(await ledger.balance(w, sku, "A-01")).toBe(0);
    });

    it("rejects an overdraw and leaves the balance unchanged", async () => {
      const ledger = await factory();
      const [w, sku] = [newWarehouse(), uniqueSku()];
      await ledger.append([move(w, sku, "A-01", 10)]);
      await expect(ledger.append([move(w, sku, "A-01", -11, "ISSUE")])).rejects.toBeInstanceOf(
        InsufficientStockError,
      );
      expect(await ledger.balance(w, sku, "A-01")).toBe(10);
    });

    it("applies both legs of a transfer together", async () => {
      const ledger = await factory();
      const [w, sku] = [newWarehouse(), uniqueSku()];
      await ledger.append([move(w, sku, "A-01", 10)]);
      await ledger.append([
        move(w, sku, "A-01", -4, "TRANSFER_OUT"),
        move(w, sku, "B-02", 4, "TRANSFER_IN"),
      ]);
      expect(await ledger.balance(w, sku, "A-01")).toBe(6);
      expect(await ledger.balance(w, sku, "B-02")).toBe(4);
    });

    it("is atomic: a failing leg rolls back the whole batch", async () => {
      const ledger = await factory();
      const [w, sku] = [newWarehouse(), uniqueSku()];
      await ledger.append([move(w, sku, "A-01", 10)]);
      // First leg is valid; second withdraws from a location with no stock.
      await expect(
        ledger.append([
          move(w, sku, "A-01", -4, "TRANSFER_OUT"),
          move(w, sku, "B-02", -1, "TRANSFER_OUT"),
        ]),
      ).rejects.toBeInstanceOf(InsufficientStockError);
      expect(await ledger.balance(w, sku, "A-01")).toBe(10);
      expect(await ledger.balance(w, sku, "B-02")).toBe(0);
    });

    it("never lets concurrent withdrawals overdraw stock", async () => {
      const ledger = await factory();
      const [w, sku] = [newWarehouse(), uniqueSku()];
      await ledger.append([move(w, sku, "A-01", 10)]);

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => ledger.append([move(w, sku, "A-01", -1, "ISSUE")])),
      );

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(10);
      for (const r of results) {
        if (r.status === "rejected") expect(r.reason).toBeInstanceOf(InsufficientStockError);
      }
      expect(await ledger.balance(w, sku, "A-01")).toBe(0);
    });
  });
}
