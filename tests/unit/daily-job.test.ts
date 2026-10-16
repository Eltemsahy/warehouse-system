import { describe, expect, it } from "vitest";
import { DailyJob, msUntilNextRun } from "../../shared/jobs/index.js";

const HOUR = 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

describe("msUntilNextRun", () => {
  it("waits for later today when the hour has not come yet", () => {
    expect(msUntilNextRun(at("2026-10-13T01:00:00Z"), 2)).toBe(1 * HOUR);
  });

  it("waits for tomorrow when the hour has passed", () => {
    expect(msUntilNextRun(at("2026-10-13T03:00:00Z"), 2)).toBe(23 * HOUR);
  });

  it("waits a full day when it is exactly the hour", () => {
    expect(msUntilNextRun(at("2026-10-13T02:00:00.000Z"), 2)).toBe(24 * HOUR);
  });

  it("crosses a month boundary", () => {
    expect(msUntilNextRun(at("2026-10-31T23:30:00Z"), 2)).toBe(2.5 * HOUR);
  });
});

describe("DailyJob", () => {
  it("rejects an invalid hour", () => {
    expect(() => new DailyJob("x", 24, async () => undefined)).toThrow(RangeError);
    expect(() => new DailyJob("x", -1, async () => undefined)).toThrow(RangeError);
    expect(() => new DailyJob("x", 1.5, async () => undefined)).toThrow(RangeError);
  });

  it("runs the job on demand", async () => {
    let calls = 0;
    const job = new DailyJob("count", 2, async () => {
      calls += 1;
    });
    await job.runNow();
    expect(calls).toBe(1);
  });

  it("logs a failing job instead of throwing", async () => {
    const job = new DailyJob("broken", 2, async () => {
      throw new Error("boom");
    });
    await expect(job.runNow()).resolves.toBeUndefined();
  });

  it("does not run immediately when started, and stops cleanly", async () => {
    let calls = 0;
    const job = new DailyJob("later", 2, async () => {
      calls += 1;
    });
    job.start();
    await job.stop();
    expect(calls).toBe(0);
  });
});
