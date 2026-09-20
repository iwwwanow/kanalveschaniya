import { defineConfig } from "drizzle-kit";

// `bun run db:generate` after changing src/infrastructure/db/schema/app.ts — writes drizzle/app/*.sql
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/infrastructure/db/schema/app.ts",
  out: "./drizzle/app",
});
