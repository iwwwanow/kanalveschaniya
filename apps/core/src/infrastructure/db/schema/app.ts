import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// app.db — application/domain-owned tables. Column types mirror the tables that already exist in
// production databases (see drizzle/app/0000_*.sql, the baseline).

// `queue` itself is defined in packages/shared-queue (shared kernel with session-service) — core
// still owns app.db's migrations, so it's re-exported here for drizzle-kit (which needs every
// table for a given db visible from this one schema file) and for the rest of core to keep
// importing it from "../db/schema/app" as before.
export { queueTable } from "shared-queue";

export const resourceTable = sqliteTable("resource", {
  resourceId: text("resource_id").primaryKey(),
  url: text("url").notNull(),
  title: text("title"),
  duration: integer("duration"),
  cachedAt: integer("cached_at").default(sql`(unixepoch())`),
});

export const errorLogTable = sqliteTable("error_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  url: text("url").notNull(),
  error: text("error").notNull(),
  createdAt: integer("created_at").default(sql`(unixepoch())`),
});
