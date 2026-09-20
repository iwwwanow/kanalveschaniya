import type { Database } from "bun:sqlite";
import type { TelegramResourceRef, TelegramResourceRefsRepository } from "./telegram-resource-refs.interfaces";

interface Row {
  resource_id: string;
  channel_message_id: number;
}

export function createTelegramResourceRefsRepository(db: Database): TelegramResourceRefsRepository {
  return {
    async save(resourceId, channelMessageId) {
      db.run(`INSERT OR REPLACE INTO telegram_resource_refs (resource_id, channel_message_id) VALUES (?, ?)`, [
        resourceId,
        channelMessageId,
      ]);
    },

    async get(resourceId): Promise<TelegramResourceRef | null> {
      const row = db
        .query<Row, [string]>(`SELECT * FROM telegram_resource_refs WHERE resource_id = ?`)
        .get(resourceId);
      if (!row) return null;
      return { resourceId: row.resource_id, channelMessageId: row.channel_message_id };
    },
  };
}
