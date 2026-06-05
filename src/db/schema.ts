import { db } from "./index";

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id    INTEGER PRIMARY KEY,
      username   TEXT,
      first_seen INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      url         TEXT NOT NULL,
      track_id    TEXT,
      user_id     INTEGER NOT NULL,
      status      TEXT DEFAULT 'pending', -- pending | processing | done | failed | geo_blocked
      retries     INTEGER DEFAULT 0,
      retry_after INTEGER DEFAULT 0,
      error       TEXT,
      created_at  INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS error_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL,
      url        TEXT NOT NULL,
      error      TEXT NOT NULL,
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

  runMigrations();

  // Reset jobs stuck in processing from a previous crashed run
  db.run(`UPDATE queue SET status = 'pending', retry_after = 0 WHERE status = 'processing'`);
}

function runMigrations() {
  const migrations: Array<{ name: string; sql: string }> = [
    {
      name: "add_retry_after_to_queue",
      sql: "ALTER TABLE queue ADD COLUMN retry_after INTEGER DEFAULT 0",
    },
  ];

  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER DEFAULT (unixepoch())
    )
  `);

  for (const m of migrations) {
    const applied = db.query("SELECT name FROM migrations WHERE name = ?").get(m.name);
    if (applied) continue;
    try {
      db.run(m.sql);
    } catch {
      // column may already exist — ignore
    }
    db.run("INSERT OR IGNORE INTO migrations (name) VALUES (?)", [m.name]);
  }
}
