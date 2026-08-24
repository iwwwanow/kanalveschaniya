import type { Database } from "bun:sqlite";
import { unlink } from "fs/promises";
import { config } from "../config";
import type { QueueItem, QueueRepository } from "../domain/queue";
import type { Track } from "../domain/resource";
import type { DownloaderPort } from "../domain/download";
import type { NotifierPort } from "../domain/notifier";
import { type TrackStorePort, type TrackCachePort, isTrackCachePort } from "../domain/track-cache";

const MAX_RETRIES = 3;

export interface WorkerLog {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ProcessDownloadJobDeps {
  queue: QueueRepository;
  downloader: DownloaderPort;
  // Фанаут find/save по всем сторам. Те, что реализуют deliver (TrackCachePort,
  // duck-typed через isTrackCachePort) — единственный способ раздать уже кэшированный
  // трек пользователю; store без deliver (например fs) участвует только в архивации.
  stores: TrackStorePort[];
  notifier: NotifierPort;
  // Direct SQL for error_log — generic diagnostics, not domain data, per the plan's
  // decision #2 (docs/agents/planning session "noble-canyon"). Физически лежит в app.db.
  appDb: Database;
  // Playlist fan-out spawns brand-new queue jobs (application-owned, generic) that still
  // need a telegram delivery target when they complete independently later. Registering
  // that target is a telegram-infra concern, so it's injected as an opaque callback —
  // application never touches telegram_reply_refs directly.
  registerPlaylistEntryOrigin: (childJobId: number, userId: number) => Promise<void>;
}

export type ProcessDownloadJobFn = (job: QueueItem, log: WorkerLog) => Promise<void>;

export function createProcessDownloadJob(deps: ProcessDownloadJobDeps): ProcessDownloadJobFn {
  function logError(jobId: number, url: string, error: string) {
    deps.appDb.run(`INSERT INTO error_log (job_id, url, error) VALUES (?, ?, ?)`, [jobId, url, error]);
  }

  // Только find — ничего не отправляет, просто отвечает "есть готовая к раздаче копия?".
  // Смотрит только сторы с deliver (сейчас — telegram); fs-архив тут не участвует: найти
  // локальную копию не значит суметь её раздать (доставка всё равно только через
  // Telegram), локальная копия — архив, не источник дедупа, см. docs/specs/types.md.
  // Сам deliver() вызывающий код делает отдельным явным шагом — не спрятан внутри find.
  async function findDeliverable(trackId: string): Promise<{ store: TrackCachePort; track: Track } | null> {
    for (const store of deps.stores) {
      if (!isTrackCachePort(store)) continue;
      const track = await store.find(trackId);
      if (track) return { store, track };
    }
    return null;
  }

  async function handlePlaylist(job: QueueItem, entries: Track[], log: WorkerLog) {
    let cached = 0;
    let queued = 0;

    for (const entry of entries) {
      const hit = await findDeliverable(entry.trackId);
      if (hit) {
        await hit.store.deliver(hit.track, job.id);
        cached++;
        continue;
      }

      const existing = await deps.queue.findPendingByTrackId(entry.trackId);
      if (!existing) {
        const childId = await deps.queue.enqueue({
          url: entry.url,
          userId: job.userId,
          trackId: entry.trackId,
        });
        await deps.registerPlaylistEntryOrigin(childId, job.userId);
        queued++;
      }
    }

    log.info(`job ${job.id} | playlist done | cached=${cached} queued=${queued}`);
    await deps.notifier.notifyPlaylistQueued(job.id, { queued, cached });
  }

  // Returns true when the job's terminal status has already been written (permanent
  // failure) — in that case the caller must NOT also mark it 'done'.
  async function runJob(job: QueueItem, log: WorkerLog): Promise<boolean> {
    let trackId = job.trackId;
    let url = job.url;

    if (!trackId) {
      const info = await deps.downloader.getInfo(url);

      if ("entries" in info) {
        log.info(`job ${job.id} | playlist | ${info.entries.length} entries`);
        await handlePlaylist(job, info.entries, log);
        return false;
      }

      trackId = info.trackId;
      url = info.url;
    }

    const hit = await findDeliverable(trackId);
    if (hit) {
      log.info(`job ${job.id} | cache hit | track_id=${trackId}`);
      await hit.store.deliver(hit.track, job.id);
      return false;
    }

    log.info(`job ${job.id} | downloading | ${url}`);
    const result = await deps.downloader.download(url);

    if (!result.ok) {
      log.error(`job ${job.id} | permanent failure | blockReason=${result.blockReason ?? "-"} | ${result.error.split("\n")[0]}`);
      logError(job.id, job.url, result.error);
      await deps.queue.updateStatus(job.id, "failed", {
        error: result.error,
        blockReason: result.blockReason ?? null,
      });
      await deps.notifier.notify(job.id, result);
      return true;
    }

    log.info(`job ${job.id} | downloaded | ${result.track.title}`);

    const fileSize = Bun.file(result.filePath).size;
    if (fileSize > config.maxFileSizeBytes) {
      await unlink(result.filePath).catch(() => {});
      log.warn(`job ${job.id} | skipped — exceeds 50MB | ${result.track.title}`);
      await deps.notifier.notify(job.id, {
        ok: false,
        error: `Трек "${result.track.title}" превышает лимит 50MB и был пропущен`,
        blockReason: "too_large",
        retryable: false,
      });
      return false;
    }

    log.info(`job ${job.id} | storing (${deps.stores.length} backend(s))`);
    let delivered = false;
    for (const store of deps.stores) {
      await store.save(result.track, result.filePath);
      if (isTrackCachePort(store)) {
        await store.deliver(result.track, job.id);
        delivered = true;
      }
    }

    // Ни один стор не смог сам доставить (например только fs-архив без Telegram-кэша) —
    // шлём свежескачанные байты напрямую через NotifierPort.
    if (!delivered) {
      log.info(`job ${job.id} | sending directly to user (no deliverable store)`);
      await deps.notifier.notify(job.id, result);
    }

    // Все TrackStorePort.save() только читают/копируют исходник, никогда не забирают
    // владение им (см. docs/specs/types.md) — временный файл всегда чистим сами.
    await unlink(result.filePath).catch(() => {});

    return false;
  }

  return async function processDownloadJob(job, log) {
    try {
      const finalized = await runJob(job, log);
      if (!finalized) {
        await deps.queue.updateStatus(job.id, "done");
        log.info(`job ${job.id} | done`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logError(job.id, job.url, error);

      // Off-by-one fix (plan decision #6): exhausted is checked on retries *already
      // spent*, so all three backoffs (30s/60s/120s) fire before the job is failed.
      const exhausted = job.retries >= MAX_RETRIES;

      log.error(`job ${job.id} | attempt ${job.retries + 1} | exhausted=${exhausted} | ${error.split("\n")[0]}`);

      if (exhausted) {
        await deps.queue.updateStatus(job.id, "failed", { error });
        await deps.notifier.notify(job.id, { ok: false, error, retryable: false });
      } else {
        const delayMs = 30_000 * Math.pow(2, job.retries);
        const retryAt = Math.floor(Date.now() / 1000) + Math.floor(delayMs / 1000);
        await deps.queue.updateStatus(job.id, "pending", {
          retries: job.retries + 1,
          error,
          retryAfter: retryAt,
        });
        log.info(`job ${job.id} | requeued for retry in ${delayMs / 1000}s`);
      }
    }
  };
}
