import type { Database } from "bun:sqlite";
import type { TelegramTrackRef, TelegramTrackRefsRepository } from "./telegram-track-refs.interfaces";

interface Row {
  track_id: string;
  channel_message_id: number;
}

export function createTelegramTrackRefsRepository(db: Database): TelegramTrackRefsRepository {
  return {
    async save(trackId, channelMessageId) {
      db.run(`INSERT OR REPLACE INTO telegram_track_refs (track_id, channel_message_id) VALUES (?, ?)`, [
        trackId,
        channelMessageId,
      ]);
    },

    async get(trackId): Promise<TelegramTrackRef | null> {
      const row = db
        .query<Row, [string]>(`SELECT * FROM telegram_track_refs WHERE track_id = ?`)
        .get(trackId);
      if (!row) return null;
      return { trackId: row.track_id, channelMessageId: row.channel_message_id };
    },
  };
}
