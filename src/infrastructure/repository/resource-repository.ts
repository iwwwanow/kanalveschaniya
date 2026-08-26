import type { Database } from "bun:sqlite";
import type { ResourceRepository, Track } from "../../domain/resource";

interface ResourceRow {
  track_id: string;
  url: string;
  title: string | null;
  duration: number | null;
}

export function createResourceRepository(db: Database): ResourceRepository {
  return {
    async findByTrackId(trackId) {
      const row = db
        .query<ResourceRow, [string]>(`SELECT track_id, url, title, duration FROM resource WHERE track_id = ?`)
        .get(trackId);
      if (!row) return null;
      return {
        trackId: row.track_id,
        url: row.url,
        title: row.title ?? "",
        duration: row.duration ?? 0,
      };
    },

    async save(track: Track) {
      db.run(`INSERT OR REPLACE INTO resource (track_id, url, title, duration) VALUES (?, ?, ?, ?)`, [
        track.trackId,
        track.url,
        track.title,
        track.duration,
      ]);
    },
  };
}
