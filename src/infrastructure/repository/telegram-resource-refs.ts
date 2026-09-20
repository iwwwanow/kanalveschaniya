import type { Database } from "bun:sqlite";
import type { TelegramResourceRef, TelegramResourceRefsRepository } from "./telegram-resource-refs.interfaces";

interface Row {
  track_id: string;
  channel_message_id: number;
}

export function createTelegramResourceRefsRepository(db: Database): TelegramResourceRefsRepository {
  return {
    async save(resourceId, channelMessageId) {
      db.run(`INSERT OR REPLACE INTO telegram_track_refs (track_id, channel_message_id) VALUES (?, ?)`, [
        resourceId,
        channelMessageId,
      ]);
    },

    async get(resourceId): Promise<TelegramResourceRef | null> {
      const row = db
        .query<Row, [string]>(`SELECT * FROM telegram_track_refs WHERE track_id = ?`)
        .get(resourceId);
      if (!row) return null;
      return { resourceId: row.track_id, channelMessageId: row.channel_message_id };
    },
  };
}
