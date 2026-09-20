// why we dont use drizze with schema & migrations?
import { Database } from "bun:sqlite";
import { join } from "path";
import { renameColumnIfExists, renameTableIfExists } from "./schema-utils";

// telegram.db — telegram-owned: telegram_reply_refs, telegram_resource_refs, users.
// Private zone of infra/{presentation,adapters,repository} — domain/application don't
// know this file exists.
export function openTelegramDb(dataDir: string): Database {
  const db = new Database(join(dataDir, "telegram.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");

  // Track -> Resource rename (2026-09): converts existing databases, no-op on fresh ones.
  db.transaction(() => {
    renameTableIfExists(db, "telegram_track_refs", "telegram_resource_refs");
    renameColumnIfExists(db, "telegram_resource_refs", "track_id", "resource_id");
  })();

  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_reply_refs (
      job_id     INTEGER PRIMARY KEY,
      chat_id    INTEGER NOT NULL,
      message_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS telegram_resource_refs (
      resource_id        TEXT PRIMARY KEY,
      channel_message_id INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id    INTEGER PRIMARY KEY,
      username   TEXT,
      first_seen INTEGER DEFAULT (unixepoch())
    );
  `);

  runTelegramMigrations(db);

  return db;
}

function runTelegramMigrations(db: Database) {
  const migrations: Array<{ name: string; sql: string }> = [
    // Add future telegram.db migrations here — same pattern as the old src/db/schema.ts.
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
