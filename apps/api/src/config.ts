import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default("postgres://wms:wms@localhost:5432/wms"),
});
export const config = schema.parse(process.env);
