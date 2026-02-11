// src/storage/db/schema.ts
import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const resources = sqliteTable('resources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull().unique(),
  status: text('status', {
    enum: ['pending', 'processing', 'downloaded', 'error'],
  }).default('pending'),
  dateUpdated: integer('date_updated', { mode: 'timestamp' }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const queue = sqliteTable('queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceId: integer('resource_id')
    .notNull()
    .references(() => resources.id, { onDelete: 'cascade' }),
  scheduledAt: integer('scheduled_at', { mode: 'timestamp' }).default(
    sql`(strftime('%s', 'now'))`,
  ),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
});

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;

export type Queue = typeof queue.$inferSelect;
export type NewQueue = typeof queue.$inferInsert;
