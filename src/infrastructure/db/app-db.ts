import { Database } from "bun:sqlite";
import { join } from "path";

// app.db — application/domain-owned: queue, resource (Track), error_log.
// No telegram-specific columns (see docs/diary/2026-08-22_..., audit finding #1).
export function openAppDb(dataDir: string): Database {
  const db = new Database(join(dataDir, "app.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      url          TEXT NOT NULL,
      track_id     TEXT,
      user_id      INTEGER NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
      block_reason TEXT,
      retries      INTEGER NOT NULL DEFAULT 0,
      retry_after  INTEGER DEFAULT 0,
      error        TEXT,
      created_at   INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS resource (
      track_id   TEXT PRIMARY KEY,
      url        TEXT NOT NULL,
      title      TEXT,
      duration   INTEGER,
      cached_at  INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS error_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL,
      url        TEXT NOT NULL,
      error      TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  runAppMigrations(db);

  // Reset jobs stuck in processing from a previous crashed run.
  db.run(`UPDATE queue SET status = 'pending', retry_after = 0 WHERE status = 'processing'`);

  return db;
}

function runAppMigrations(db: Database) {
  const migrations: Array<{ name: string; sql: string }> = [
    // Add future app.db migrations here — same pattern as the old src/db/schema.ts.
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
