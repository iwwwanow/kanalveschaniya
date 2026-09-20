import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { QueueStatus } from "../../../domain/queue";

// app.db — application/domain-owned tables. Column types mirror the tables that already exist in
// production databases (see drizzle/app/0000_*.sql, the baseline).

export const queueTable = sqliteTable("queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  resourceId: text("resource_id"),
  userId: integer("user_id").notNull(),
  status: text("status").$type<QueueStatus>().notNull().default("pending" as QueueStatus),
  blockReason: text("block_reason"),
  retries: integer("retries").notNull().default(0),
  retryAfter: integer("retry_after").default(0),
  error: text("error"),
  createdAt: integer("created_at").default(sql`(unixepoch())`),
});

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
