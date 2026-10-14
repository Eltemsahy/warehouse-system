import { logger as defaultLogger } from "../../../shared/observability/index.js";
import type { LedgerAuditor, LedgerDiscrepancy } from "./ports.js";

export interface LedgerIntegrityReport {
  checkedAt: Date;
  ok: boolean;
  /** At most `maxReported` entries. */
  discrepancies: LedgerDiscrepancy[];
  /** True when there were more discrepancies than were listed. */
  truncated: boolean;
}

type Log = Pick<typeof defaultLogger, "info" | "error">;

/**
 * Nightly reconciliation (TRD s10, Schema doc s14): for every (sku, location),
 * sum(quantity_delta) must equal stock_levels.quantity. Any mismatch is logged at error
 * level, which is what alerting hooks onto, and returned to the caller.
 */
export class CheckLedgerIntegrity {
  constructor(
    private auditor: LedgerAuditor,
    private log: Log = defaultLogger,
    private maxReported = 100,
  ) {}

  async execute(): Promise<LedgerIntegrityReport> {
    // Ask for one more than we will list, to know whether the list was cut short.
    const found = await this.auditor.findDiscrepancies(this.maxReported + 1);
    const truncated = found.length > this.maxReported;
    const discrepancies = truncated ? found.slice(0, this.maxReported) : found;
    const report: LedgerIntegrityReport = {
      checkedAt: new Date(),
      ok: discrepancies.length === 0,
      discrepancies,
      truncated,
    };

    if (report.ok) {
      this.log.info("ledger integrity check passed");
    } else {
      this.log.error("ledger integrity check FAILED: ledger and stock_levels disagree", {
        discrepancies: discrepancies.length,
        truncated,
        sample: discrepancies.slice(0, 10),
      });
    }
    return report;
  }
}