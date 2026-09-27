import { defineConfig } from "drizzle-kit";

// `bun run db:generate` (from repo root) after changing src/infrastructure/db/schema/telegram.ts —
// writes apps/core/drizzle/telegram/*.sql. Paths here are relative to this file's directory
// (apps/core), since db:generate cd's into it before invoking drizzle-kit — keeps this app
// self-contained.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/infrastructure/db/schema/telegram.ts",
  out: "./drizzle/telegram",
});
