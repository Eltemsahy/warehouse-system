import "dotenv/config";
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["tests/**/*.test.ts", "modules/**/*.test.ts"] } });