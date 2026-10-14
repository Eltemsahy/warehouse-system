// tsc only emits .ts files. The runtime image needs the SQL next to the compiled runner
// (dist/db/migrate.js reads ./migrations relative to itself).
import { cpSync } from "node:fs";

cpSync("db/migrations", "dist/db/migrations", { recursive: true });
console.log("copied db/migrations -> dist/db/migrations");
