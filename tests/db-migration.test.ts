import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "path";
import { openAppDb } from "../src/infrastructure/db/app-db";
import { openTelegramDb } from "../src/infrastructure/db/telegram-db";
import { createQueueRepository } from "../src/infrastructure/repository/queue-repository";
import { createResourceRepository } from "../src/infrastructure/repository/resource-repository";
import { createTelegramResourceRefsRepository } from "../src/infrastructure/repository/telegram-resource-refs";
import { tmpDir } from "./helpers";

// Databases as they were before the Track -> Resource rename (track_id / telegram_track_refs), built with raw SQL.
function legacyFixture(): string {
  const dir = tmpDir("kv-legacy-");
  const app = new Database(join(dir, "app.db"), { create: true });
  app.exec(`
    CREATE TABLE queue (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, track_id TEXT, user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', block_reason TEXT, retries INTEGER NOT NULL DEFAULT 0,
      retry_after INTEGER DEFAULT 0, error TEXT, created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE resource (track_id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT, duration INTEGER, cached_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, url TEXT NOT NULL, error TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch()));
    INSERT INTO queue (url, track_id, user_id, status) VALUES ('http://a','sc-1',7,'pending'),('http://b',NULL,7,'done');
    INSERT INTO resource (track_id, url, title, duration) VALUES ('sc-1','http://a','Title A',120);
  `);
  app.close();
  const tg = new Database(join(dir, "telegram.db"), { create: true });
  tg.exec(`
    CREATE TABLE telegram_reply_refs (job_id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, message_id INTEGER);
    CREATE TABLE telegram_track_refs (track_id TEXT PRIMARY KEY, channel_message_id INTEGER NOT NULL);
    CREATE TABLE users (user_id INTEGER PRIMARY KEY, username TEXT, first_seen INTEGER DEFAULT (unixepoch()));
    INSERT INTO telegram_track_refs VALUES ('sc-1', 555);
    INSERT INTO telegram_reply_refs VALUES (1, 100, 200);
    INSERT INTO users (user_id, username) VALUES (7, 'kir');
  `);
  tg.close();
  return dir;
}

const columns = (db: Database, table: string) =>
  db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const tables = (db: Database) =>
  db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);

describe("track_id -> resource_id conversion", () => {
  test("converts a legacy database, keeps the data, and is idempotent on restart", async () => {
    const dir = legacyFixture();

    for (let start = 1; start <= 2; start++) {
      const app = openAppDb(dir);
      const tg = openTelegramDb(dir);

      expect(columns(app, "queue")).toContain("resource_id");
      expect(columns(app, "queue")).not.toContain("track_id");
      expect(columns(app, "resource")).toContain("resource_id");
      expect(tables(tg)).toContain("telegram_resource_refs");
      expect(tables(tg)).not.toContain("telegram_track_refs"); // no ghost table left after a restart

      expect((await createQueueRepository(app).findPendingByResourceId("sc-1"))?.url).toBe("http://a");
      expect((await createResourceRepository(app).findByResourceId("sc-1"))?.title).toBe("Title A");
      expect((await createTelegramResourceRefsRepository(tg).get("sc-1"))?.channelMessageId).toBe(555);
      expect(tg.query<{ c: number }, []>("SELECT COUNT(*) c FROM users").get()!.c).toBe(1);
      expect(tg.query<{ c: number }, []>("SELECT COUNT(*) c FROM telegram_reply_refs").get()!.c).toBe(1);

      // Drizzle's own journal: the baseline is recorded once and not re-applied on restart
      expect(app.query<{ c: number }, []>("SELECT COUNT(*) c FROM __drizzle_migrations").get()!.c).toBe(1);
      expect(tg.query<{ c: number }, []>("SELECT COUNT(*) c FROM __drizzle_migrations").get()!.c).toBe(1);

      app.close();
      tg.close();
    }
  });

  test("a fresh database gets the new schema directly and works end-to-end", async () => {
    const dir = tmpDir("kv-fresh-");
    const app = openAppDb(dir);
    const tg = openTelegramDb(dir);
    const queue = createQueueRepository(app);

    const id = await queue.enqueue({ url: "http://n", userId: 1, resourceId: "n-1" });
    await createResourceRepository(app).save({ resourceId: "n-1", url: "http://n", title: "N", duration: 5 });
    await createTelegramResourceRefsRepository(tg).save("n-1", 42);

    expect((await queue.findPendingByResourceId("n-1"))?.id).toBe(id);
    expect(columns(app, "queue")).not.toContain("track_id");
    expect(tables(tg)).not.toContain("telegram_track_refs");
  });
});
