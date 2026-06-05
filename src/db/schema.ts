import { db } from "./index";

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id    INTEGER PRIMARY KEY,
      username   TEXT,
      first_seen INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS queue (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      url        TEXT NOT NULL,
      track_id   TEXT,
      user_id    INTEGER NOT NULL,
      status     TEXT DEFAULT 'pending',
      retries    INTEGER DEFAULT 0,
      error      TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS tracks (
      track_id           TEXT PRIMARY KEY,
      url                TEXT NOT NULL,
      channel_message_id INTEGER NOT NULL,
      title              TEXT,
      duration           INTEGER,
      is_video           INTEGER DEFAULT 0,
      cached_at          INTEGER DEFAULT (unixepoch())
    );
  `);
}
