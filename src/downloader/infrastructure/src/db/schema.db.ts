import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const queueTasks = sqliteTable('queue_tasks', {
  id: text('id').primaryKey(),
  url: text('url').notNull().unique(),
  priority: integer('priority').default(0),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const resources = sqliteTable('resources', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  filepath: text('filepath').notNull(),
  source_url: text('source_url').notNull().unique(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const schema = { queueTasks, resources };
