import type { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { telegramReplyRefsTable } from "../db/schema/telegram";
import type { TelegramReplyRef, TelegramReplyRefsRepository } from "./telegram-reply-refs.interfaces";

export function createTelegramReplyRefsRepository(db: Database): TelegramReplyRefsRepository {
  const orm = drizzle(db);

  return {
    async save(jobId, chatId, messageId) {
      orm
        .insert(telegramReplyRefsTable)
        .values({ jobId, chatId, messageId })
        .onConflictDoUpdate({ target: telegramReplyRefsTable.jobId, set: { chatId, messageId } })
        .run();
    },

    async get(jobId): Promise<TelegramReplyRef | null> {
      const row = orm.select().from(telegramReplyRefsTable).where(eq(telegramReplyRefsTable.jobId, jobId)).get();
      return row ? { jobId: row.jobId, chatId: row.chatId, messageId: row.messageId } : null;
    },
  };
}
