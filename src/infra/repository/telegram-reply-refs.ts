import type { Database } from "bun:sqlite";
import type { TelegramReplyRef, TelegramReplyRefsRepository } from "./telegram-reply-refs.interfaces";

interface Row {
  job_id: number;
  chat_id: number;
  message_id: number | null;
}

export function createTelegramReplyRefsRepository(db: Database): TelegramReplyRefsRepository {
  return {
    async save(jobId, chatId, messageId) {
      db.run(`INSERT OR REPLACE INTO telegram_reply_refs (job_id, chat_id, message_id) VALUES (?, ?, ?)`, [
        jobId,
        chatId,
        messageId,
      ]);
    },

    async get(jobId): Promise<TelegramReplyRef | null> {
      const row = db.query<Row, [number]>(`SELECT * FROM telegram_reply_refs WHERE job_id = ?`).get(jobId);
      if (!row) return null;
      return { jobId: row.job_id, chatId: row.chat_id, messageId: row.message_id };
    },
  };
}
