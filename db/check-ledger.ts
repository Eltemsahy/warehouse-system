// Runs the ledger integrity check once and exits: 0 = consistent, 1 = mismatch, 2 = could not
// run. Use it from an external scheduler (cron, a Kubernetes CronJob) or by hand:
//   npm run check:ledger
import "dotenv/config";
import pg from "pg";
import { CheckLedgerIntegrity, PgLedgerAuditor } from "../modules/inventory/index.js";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://wms:wms@localhost:5432/wms",
});

try {
  const report = await new CheckLedgerIntegrity(new PgLedgerAuditor(pool)).execute();
  if (!report.ok) process.exitCode = 1;
} catch (e) {
  console.error("ledger integrity check could not run:", e);
  process.exitCode = 2;
} finally {
  await pool.end();
}
