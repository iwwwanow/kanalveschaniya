import { defineConfig } from "drizzle-kit";

// `bun run db:generate:session` (from repo root) after changing
// src/infrastructure/db/schema/session.ts — writes drizzle/session/*.sql. Paths here are relative
// to this file's directory (apps/session), same convention as apps/core's drizzle.*.config.ts.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/infrastructure/db/schema/session.ts",
  out: "./drizzle/session",
});
