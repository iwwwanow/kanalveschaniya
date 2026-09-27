import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { QueueStatus } from "./queue-status";

// The `queue` table itself — shared kernel between core and session-service. It lives in core's
// app.db and core owns its migrations (apps/core/src/infrastructure/db/app-db.ts), but the table
// definition is exported from here so a session-service connector queries the exact same columns
// core does, instead of a hand-guessed copy that can silently drift the moment core's schema
// changes. Column types mirror the tables that already exist in production databases (see
// apps/core/drizzle/app/0000_*.sql, the baseline).
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
  // staged delivery (see QueueStatus): the downloaded file and the delivery stage's own retry state
  filePath: text("file_path"),
  deliverRetries: integer("deliver_retries").notNull().default(0),
  deliverRetryAfter: integer("deliver_retry_after"),
});

// Inferred straight from the table above — a consumer (session-service's connector, core's own
// repository) gets a row type that can't drift from the actual columns, instead of a hand-written
// interface kept in sync by hand. Raw DB shape (e.g. blockReason: string | null, not BlockReason |
// null) — parsing/validating a column into a richer domain type, when a consumer wants that, is
// its own concern (see core's parseBlockReason usage in queue-repository.ts's toQueueItem()).
export type QueueRow = typeof queueTable.$inferSelect;
export type NewQueueRow = typeof queueTable.$inferInsert;
