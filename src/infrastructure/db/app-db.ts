import { Database } from "bun:sqlite";
import { join } from "path";
import { renameColumnIfExists } from "./schema-utils";

// app.db — application/domain-owned: queue, resource, error_log.
// No telegram-specific columns (see docs/diary/2026-08-22_..., audit finding #1).
export function openAppDb(dataDir: string): Database {
  const db = new Database(join(dataDir, "app.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");

  // Track -> Resource rename (2026-09): converts existing databases, no-op on fresh ones.
  db.transaction(() => {
    renameColumnIfExists(db, "queue", "track_id", "resource_id");
    renameColumnIfExists(db, "resource", "track_id", "resource_id");
  })();

  db.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      url          TEXT NOT NULL,
      resource_id  TEXT,
      user_id      INTEGER NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
      block_reason TEXT,
      retries      INTEGER NOT NULL DEFAULT 0,
      retry_after  INTEGER DEFAULT 0,
      error        TEXT,
      created_at   INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS resource (
      resource_id TEXT PRIMARY KEY,
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
