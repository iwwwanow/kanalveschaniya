import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { logger } from "../../logger";

interface LegacyUserRow {
  user_id: number;
  username: string | null;
  first_seen: number;
}

interface LegacyTrackRow {
  track_id: string;
  url: string;
  channel_message_id: number;
  title: string | null;
  duration: number | null;
  cached_at: number;
}

interface LegacyErrorLogRow {
  job_id: number;
  url: string;
  error: string;
  created_at: number;
}

interface LegacyQueueRow {
  id: number;
  url: string;
  track_id: string | null;
  user_id: number;
  status: string;
  retries: number;
  retry_after: number | null;
  error: string | null;
  created_at: number;
}

export interface MigrateLegacyDbOptions {
  dataDir: string;
  appDb: Database;
  telegramDb: Database;
  // Whether data/app.db already existed BEFORE openAppDb() was called this run — computed
  // by the caller (main.ts) before opening the database (bun:sqlite creates the file on
  // open with {create:true}, so checking existence after opening would always be true).
  // This is the idempotency guard: run only once, on the first startup after a legacy
  // data/bot.db is found and app.db doesn't exist yet.
  appDbAlreadyExisted: boolean;
}

// Runs on every startup (see main.ts). No-ops silently unless data/bot.db exists and
// app.db does not — i.e. this is the very first startup against a legacy single-file DB.
// Never deletes or renames bot.db — it stays as a free backup.
export function migrateLegacyDb(opts: MigrateLegacyDbOptions): void {
  const { dataDir, appDb, telegramDb, appDbAlreadyExisted } = opts;
  const legacyPath = join(dataDir, "bot.db");

  if (appDbAlreadyExisted || !existsSync(legacyPath)) {
    return;
  }

  logger.info(`legacy bot.db found at ${legacyPath} — migrating to app.db + telegram.db`);

  const legacyDb = new Database(legacyPath, { readonly: true });

  try {
    const users = legacyDb
      .query<LegacyUserRow, []>("SELECT user_id, username, first_seen FROM users")
      .all();
    const insertUser = telegramDb.query(
      "INSERT OR IGNORE INTO users (user_id, username, first_seen) VALUES (?, ?, ?)"
    );
    for (const u of users) insertUser.run(u.user_id, u.username, u.first_seen);

    const tracks = legacyDb
      .query<LegacyTrackRow, []>(
        "SELECT track_id, url, channel_message_id, title, duration, cached_at FROM tracks"
      )
      .all();
    const insertResource = appDb.query(
      "INSERT OR IGNORE INTO resource (track_id, url, title, duration, cached_at) VALUES (?, ?, ?, ?, ?)"
    );
    const insertTrackRef = telegramDb.query(
      "INSERT OR IGNORE INTO telegram_track_refs (track_id, channel_message_id) VALUES (?, ?)"
    );
    for (const t of tracks) {
      insertResource.run(t.track_id, t.url, t.title, t.duration, t.cached_at);
      insertTrackRef.run(t.track_id, t.channel_message_id);
    }

    const errorLogs = legacyDb
      .query<LegacyErrorLogRow, []>("SELECT job_id, url, error, created_at FROM error_log")
      .all();
    const insertErrorLog = appDb.query(
      "INSERT INTO error_log (job_id, url, error, created_at) VALUES (?, ?, ?, ?)"
    );
    for (const e of errorLogs) insertErrorLog.run(e.job_id, e.url, e.error, e.created_at);

    const queueRows = legacyDb
      .query<LegacyQueueRow, []>(
        "SELECT id, url, track_id, user_id, status, retries, retry_after, error, created_at FROM queue"
      )
      .all();
    const insertQueue = appDb.query(
      `INSERT INTO queue (id, url, track_id, user_id, status, block_reason, retries, retry_after, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // messageId=NULL — these jobs survived from before reply-target tracking existed;
    // TelegramReplyRef.messageId is number|null precisely for this case (plan decision).
    const insertReplyRef = telegramDb.query(
      "INSERT OR IGNORE INTO telegram_reply_refs (job_id, chat_id, message_id) VALUES (?, ?, NULL)"
    );

    let queueMigrated = 0;
    let replyRefsSynthesized = 0;
    for (const q of queueRows) {
      let status = q.status;
      let blockReason: string | null = null;
      if (status === "processing") status = "pending";
      if (status === "geo_blocked") {
        status = "failed";
        blockReason = "geo";
      }
      insertQueue.run(q.id, q.url, q.track_id, q.user_id, status, blockReason, q.retries, q.retry_after, q.error, q.created_at);
      queueMigrated++;
      if (status !== "done") {
        insertReplyRef.run(q.id, q.user_id);
        replyRefsSynthesized++;
      }
    }

    logger.info(
      `legacy migration complete: users=${users.length} resource=${tracks.length} ` +
        `error_log=${errorLogs.length} queue=${queueMigrated} reply_refs_synthesized=${replyRefsSynthesized}`
    );
  } finally {
    legacyDb.close();
  }
}
