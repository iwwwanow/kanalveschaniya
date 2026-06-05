import { db } from "../db";
import { config } from "../config";
import { getInfo, download } from "./downloader";
import { logger } from "../logger";
import type { Telegraf } from "telegraf";
import { unlink, rename, mkdir } from "fs/promises";
import { basename, join } from "path";

type WorkerLog = ReturnType<typeof logger.worker>;

const MAX_RETRIES = 3;

interface QueueRow {
  id: number;
  url: string;
  track_id: string | null;
  user_id: number;
  retries: number;
}

interface TrackRow {
  channel_message_id: number;
}

function isNotFound(error: string): boolean {
  return error.includes("HTTP Error 404");
}

function isGeoBlocked(error: string): boolean {
  return (
    error.includes("geo restriction") ||
    error.includes("not available in your country") ||
    error.includes("not available from your location")
  );
}

function claimNextJob(): QueueRow | null {
  const job = db
    .query<QueueRow, []>(
      `SELECT id, url, track_id, user_id, retries
       FROM queue
       WHERE status = 'pending'
         AND (retry_after IS NULL OR retry_after <= unixepoch())
       ORDER BY id ASC
       LIMIT 1`
    )
    .get();

  if (!job) return null;

  db.run(`UPDATE queue SET status = 'processing' WHERE id = ?`, [job.id]);
  return job;
}

async function runWorker(bot: Telegraf, workerId: number) {
  const log = logger.worker(workerId);
  log.info("started");

  while (true) {
    try {
      await workerLoop(bot, workerId, log);
    } catch (err) {
      log.error("unexpected crash, restarting in 5s:", err);
      await Bun.sleep(5_000);
    }
  }
}

async function workerLoop(bot: Telegraf, workerId: number, log: WorkerLog) {
  while (true) {
    const job = claimNextJob();

    if (!job) {
      await Bun.sleep(config.workerIntervalMs);
      continue;
    }

    log.info(`job ${job.id} | ${job.url}`);

    try {
      await processJob(bot, job, log);
      db.run(`UPDATE queue SET status = 'done' WHERE id = ?`, [job.id]);
      log.info(`job ${job.id} | done`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const geo = isGeoBlocked(error);
      const notFound = isNotFound(error);
      const exhausted = job.retries + 1 >= MAX_RETRIES;

      log.error(`job ${job.id} | attempt ${job.retries + 1}/${MAX_RETRIES} | geo=${geo} notFound=${notFound} | ${error.split("\n")[0]}`);

      // Always log to error history
      db.run(
        `INSERT INTO error_log (job_id, url, error) VALUES (?, ?, ?)`,
        [job.id, job.url, error]
      );

      if (geo) {
        db.run(`UPDATE queue SET status = 'geo_blocked', error = ? WHERE id = ?`, [error, job.id]);
        log.warn(`job ${job.id} | geo_blocked — сохранён для повтора при наличии прокси`);
        try {
          await bot.telegram.sendMessage(
            job.user_id,
            `Трек недоступен из-за гео-ограничения: ${job.url}\nБудет загружен автоматически при настройке прокси`
          );
        } catch {}
      } else if (notFound || exhausted) {
        db.run(`UPDATE queue SET status = 'failed', error = ? WHERE id = ?`, [error, job.id]);
        try {
          const reason = notFound ? "трек не найден (404)" : "превышено число попыток";
          await bot.telegram.sendMessage(
            job.user_id,
            `Не удалось загрузить: ${job.url}\nПричина: ${reason}`
          );
        } catch (notifyErr) {
          log.warn(`failed to notify user ${job.user_id}:`, notifyErr);
        }
      } else {
        // Exponential backoff: wait before requeuing (30s, 60s, 120s)
        const delayMs = 30_000 * Math.pow(2, job.retries);
        const retryAt = Math.floor(Date.now() / 1000) + delayMs / 1000;
        db.run(
          `UPDATE queue SET status = 'pending', retries = retries + 1, error = ?, retry_after = ? WHERE id = ?`,
          [error, retryAt, job.id]
        );
        log.info(`job ${job.id} | requeued for retry in ${delayMs / 1000}s`);
      }
    }
  }
}

export function startWorker(bot: Telegraf) {
  requeueGeoBlocked();

  for (let i = 1; i <= config.workerConcurrency; i++) {
    runWorker(bot, i);
  }
  logger.info(`${config.workerConcurrency} workers started`);
}

function requeueGeoBlocked() {
  if (!config.proxy) return;

  const result = db.run(
    `UPDATE queue SET status = 'pending', retries = 0, error = NULL
     WHERE status = 'geo_blocked'`
  );

  if (result.changes > 0) {
    logger.info(`requeued ${result.changes} geo_blocked jobs (proxy is set)`);
  }
}

async function processJob(bot: Telegraf, job: QueueRow, log: WorkerLog) {
  if (!job.track_id) {
    const info = await getInfo(job.url);

    if (info.entries && info.entries.length > 0) {
      log.info(`job ${job.id} | playlist "${info.title}" | ${info.entries.length} entries`);

      let cached = 0;
      let queued = 0;

      for (const entry of info.entries) {
        const cachedTrack = db
          .query<TrackRow, [string]>(
            `SELECT channel_message_id FROM tracks WHERE track_id = ?`
          )
          .get(entry.id);

        if (cachedTrack) {
          await bot.telegram.forwardMessage(job.user_id, config.channelId, cachedTrack.channel_message_id);
          cached++;
          continue;
        }

        const existing = db
          .query<{ id: number }, [string]>(
            `SELECT id FROM queue WHERE track_id = ? AND status IN ('pending','processing')`
          )
          .get(entry.id);

        if (!existing) {
          db.run(`INSERT INTO queue (url, track_id, user_id) VALUES (?, ?, ?)`, [entry.url, entry.id, job.user_id]);
          queued++;
        }
      }

      log.info(`job ${job.id} | playlist done | cached=${cached} queued=${queued}`);
      await bot.telegram.sendMessage(
        job.user_id,
        `Плейлист "${info.title}": ${queued} в очереди, ${cached} уже в кэше`
      );
      return;
    }

    job.track_id = info.id;
    job.url = info.url;
  }

  const cachedTrack = db
    .query<TrackRow, [string]>(
      `SELECT channel_message_id FROM tracks WHERE track_id = ?`
    )
    .get(job.track_id);

  if (cachedTrack) {
    log.info(`job ${job.id} | cache hit | track_id=${job.track_id}`);
    await bot.telegram.forwardMessage(job.user_id, config.channelId, cachedTrack.channel_message_id);
    return;
  }

  log.info(`job ${job.id} | downloading | ${job.url}`);
  const result = await download(job.url);
  log.info(`job ${job.id} | downloaded | ${result.title} | ${(result.fileSize / 1024 / 1024).toFixed(1)}MB`);

  if (result.fileSize > config.maxFileSizeBytes) {
    await unlink(result.filePath).catch(() => {});
    log.warn(`job ${job.id} | skipped — exceeds 50MB | ${result.title}`);
    await bot.telegram.sendMessage(job.user_id, `Трек "${result.title}" превышает лимит 50MB и был пропущен`);
    return;
  }

  log.info(`job ${job.id} | uploading to channel`);
  let channelMessageId: number;

  if (result.isVideo) {
    const msg = await bot.telegram.sendVideo(
      config.channelId,
      { source: result.filePath },
      { caption: result.title, duration: result.duration }
    );
    channelMessageId = msg.message_id;
  } else {
    const msg = await bot.telegram.sendAudio(
      config.channelId,
      { source: result.filePath },
      { caption: result.title, duration: result.duration, title: result.title }
    );
    channelMessageId = msg.message_id;
  }

  db.run(
    `INSERT INTO tracks (track_id, url, channel_message_id, title, duration, is_video) VALUES (?, ?, ?, ?, ?, ?)`,
    [job.track_id, job.url, channelMessageId, result.title, result.duration ?? null, result.isVideo ? 1 : 0]
  );

  await bot.telegram.forwardMessage(job.user_id, config.channelId, channelMessageId);
  await saveToContent(result.filePath, result.isVideo, log);
  log.info(`job ${job.id} | forwarded to user ${job.user_id}`);
}

async function saveToContent(filePath: string, isVideo: boolean, log: WorkerLog) {
  try {
    const subdir = isVideo ? "mp4" : "mp3";
    const destDir = join(config.contentDir, subdir);
    await mkdir(destDir, { recursive: true });
    const dest = join(destDir, basename(filePath));
    await rename(filePath, dest);
    log.info(`saved to content | ${dest}`);
  } catch (err) {
    log.warn(`failed to save to content dir, deleting instead:`, err);
    await unlink(filePath).catch(() => {});
  }
}
