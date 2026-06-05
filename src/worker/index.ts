import { db } from "../db";
import { config } from "../config";
import { getInfo, download } from "./downloader";
import type { Telegraf } from "telegraf";
import { unlink } from "fs/promises";

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

const MAX_RETRIES = 3;

export function startWorker(bot: Telegraf) {
  const tick = async () => {
    const job = db
      .query<QueueRow, []>(
        `SELECT id, url, track_id, user_id, retries
         FROM queue
         WHERE status = 'pending'
         ORDER BY id ASC
         LIMIT 1`
      )
      .get();

    if (!job) return;

    db.run(`UPDATE queue SET status = 'processing' WHERE id = ?`, [job.id]);

    try {
      await processJob(bot, job);
      db.run(`UPDATE queue SET status = 'done' WHERE id = ?`, [job.id]);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[worker] job ${job.id} failed:`, error);

      if (job.retries + 1 >= MAX_RETRIES) {
        db.run(`UPDATE queue SET status = 'failed', error = ? WHERE id = ?`, [
          error,
          job.id,
        ]);
        try {
          await bot.telegram.sendMessage(
            job.user_id,
            `Не удалось загрузить: ${job.url}\n\n${error.slice(0, 200)}`
          );
        } catch {}
      } else {
        db.run(
          `UPDATE queue SET status = 'pending', retries = retries + 1, error = ? WHERE id = ?`,
          [error, job.id]
        );
      }
    }
  };

  setInterval(tick, config.workerIntervalMs);
  console.log("[worker] started");
}

async function processJob(bot: Telegraf, job: QueueRow) {
  // Playlist — expand into individual track jobs
  if (!job.track_id) {
    const info = await getInfo(job.url);

    if (info.entries && info.entries.length > 0) {
      for (const entry of info.entries) {
        // Check cache first
        const cached = db
          .query<TrackRow, [string]>(
            `SELECT channel_message_id FROM tracks WHERE track_id = ?`
          )
          .get(entry.id);

        if (cached) {
          await bot.telegram.forwardMessage(
            job.user_id,
            config.channelId,
            cached.channel_message_id
          );
          continue;
        }

        // Check if already queued
        const existing = db
          .query<{ id: number }, [string]>(
            `SELECT id FROM queue WHERE track_id = ? AND status IN ('pending','processing')`
          )
          .get(entry.id);

        if (!existing) {
          db.run(
            `INSERT INTO queue (url, track_id, user_id) VALUES (?, ?, ?)`,
            [entry.url, entry.id, job.user_id]
          );
        }
      }

      await bot.telegram.sendMessage(
        job.user_id,
        `Плейлист "${info.title}": ${info.entries.length} треков добавлено в очередь`
      );
      return;
    }

    // Single track — reprocess with track_id filled
    job.track_id = info.id;
    job.url = info.url;
  }

  // Single track
  const cached = db
    .query<TrackRow, [string]>(
      `SELECT channel_message_id FROM tracks WHERE track_id = ?`
    )
    .get(job.track_id);

  if (cached) {
    await bot.telegram.forwardMessage(
      job.user_id,
      config.channelId,
      cached.channel_message_id
    );
    return;
  }

  // Download
  const result = await download(job.url);

  if (result.fileSize > config.maxFileSizeBytes) {
    await unlink(result.filePath).catch(() => {});
    await bot.telegram.sendMessage(
      job.user_id,
      `Трек "${result.title}" превышает лимит 50MB и был пропущен`
    );
    return;
  }

  // Upload to channel
  let channelMessageId: number;

  if (result.isVideo) {
    const msg = await bot.telegram.sendVideo(config.channelId, {
      source: result.filePath,
    }, {
      caption: result.title,
      duration: result.duration,
    });
    channelMessageId = msg.message_id;
  } else {
    const msg = await bot.telegram.sendAudio(config.channelId, {
      source: result.filePath,
    }, {
      caption: result.title,
      duration: result.duration,
      title: result.title,
    });
    channelMessageId = msg.message_id;
  }

  // Save to cache
  db.run(
    `INSERT INTO tracks (track_id, url, channel_message_id, title, duration, is_video)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      job.track_id,
      job.url,
      channelMessageId,
      result.title,
      result.duration ?? null,
      result.isVideo ? 1 : 0,
    ]
  );

  // Forward to user
  await bot.telegram.forwardMessage(
    job.user_id,
    config.channelId,
    channelMessageId
  );

  // Cleanup
  await unlink(result.filePath).catch(() => {});
}
