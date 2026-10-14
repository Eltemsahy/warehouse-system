import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default("postgres://wms:wms@localhost:5432/wms"),
  LEDGER_DRIVER: z.enum(["postgres", "memory"]).default("postgres"),
  LEDGER_INTEGRITY_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(2),
});
export const config = schema.parse(process.env);
