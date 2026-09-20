import { defineConfig } from "drizzle-kit";

// `bun run db:generate` after changing src/infrastructure/db/schema/telegram.ts — writes drizzle/telegram/*.sql
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/infrastructure/db/schema/telegram.ts",
  out: "./drizzle/telegram",
});
