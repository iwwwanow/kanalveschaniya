import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// telegram.db — telegram-owned tables. domain/application don't know this file exists.

export const telegramReplyRefsTable = sqliteTable("telegram_reply_refs", {
  jobId: integer("job_id").primaryKey(),
  chatId: integer("chat_id").notNull(),
  messageId: integer("message_id"),
});

export const telegramResourceRefsTable = sqliteTable("telegram_resource_refs", {
  resourceId: text("resource_id").primaryKey(),
  channelMessageId: integer("channel_message_id").notNull(),
});

export const usersTable = sqliteTable("users", {
  userId: integer("user_id").primaryKey(),
  username: text("username"),
  firstSeen: integer("first_seen").default(sql`(unixepoch())`),
});
