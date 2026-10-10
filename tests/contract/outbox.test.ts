import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import {
  InMemoryEventBus,
  InMemoryOutbox,
  OutboxRelay,
  PgOutbox,
} from "../../shared/events/index.js";
import type { DomainEvent } from "../../shared/kernel/index.js";
import { InMemoryLedger } from "../../modules/inventory/infrastructure/in-memory-ledger.js";
import { PgStockLedger } from "../../modules/inventory/infrastructure/pg-stock-ledger.js";
import { createMovement } from "../../modules/inventory/domain/stock-movement.js";
import { outboxContract } from "./outbox.contract.js";

// In-memory always runs. Postgres runs only with LEDGER_DRIVER=postgres and DATABASE_URL set
// (CI does this against a service container).
const postgresEnabled = process.env.LEDGER_DRIVER === "postgres";
const pool = postgresEnabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : undefined;

afterAll(async () => {
  await pool?.end();
});

outboxContract("InMemoryOutbox", () => {
  const outbox = new InMemoryOutbox();
  return { ledger: new InMemoryLedger(outbox), outbox };
});

outboxContract(
  "PgOutbox",
  () => {
    if (!pool) throw new Error("Postgres pool not initialised");
    return { ledger: new PgStockLedger(pool), outbox: new PgOutbox(pool) };
  },
  { skip: !postgresEnabled },
);

describe("OutboxRelay", () => {
  const probe = (): DomainEvent => ({
    id: randomUUID(),
    name: "test.OutboxProbed",
    occurredAt: new Date(),
    payload: {},
  });
  const deposit = () =>
    createMovement({ sku: `SKU-${randomUUID()}`, locationId: "A-01", quantityDelta: 1, type: "ADJUSTMENT" });

  it("delivers committed events to bus subscribers and stops cleanly", async () => {
    const outbox = new InMemoryOutbox();
    const ledger = new InMemoryLedger(outbox);
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    bus.subscribe("test.OutboxProbed", (e) => {
      seen.push(e.id);
    });
    const relay = new OutboxRelay(outbox, (e) => bus.publish([e]), { pollIntervalMs: 10 });
    const event = probe();

    relay.start();
    await ledger.append([deposit()], [event]);
    await vi.waitFor(() => expect(seen).toEqual([event.id]));
    await relay.stop();
  });

  it("keeps the append successful and the event pending when a subscriber fails", async () => {
    const outbox = new InMemoryOutbox();
    const ledger = new InMemoryLedger(outbox);
    const bus = new InMemoryEventBus();
    bus.subscribe("test.OutboxProbed", () => {
      throw new Error("subscriber down");
    });
    const relay = new OutboxRelay(outbox, (e) => bus.publish([e]));
    const event = probe();

    // The request path never talks to subscribers, so it cannot fail because of them (G3).
    await expect(ledger.append([deposit()], [event])).resolves.toBeUndefined();
    await relay.flushOnce();

    // Scheduled for retry with backoff, not lost.
    expect(await outbox.status(event.id)).toBe("pending");
  });
});