import { unlink } from "fs/promises";
import { type QueueItem, type QueueRepository, QueueStatus, MAX_RETRIES, backoffSeconds } from "../domain/queue";
import { BlockReason } from "../domain/block-reason";
import type { Resource } from "../domain/resource";
import type { DownloaderPort, DownloadResult } from "../domain/download";
import type { ErrorLogRepository } from "../domain/error-log";
import type { NotifierPort } from "../domain/notifier";
import type { ResourceStorePort, ResourceCachePort } from "../domain/resource-cache";
import type { WorkerLog } from "./worker-log";

export interface ProcessDownloadJobDeps {
  queue: QueueRepository;
  downloader: DownloaderPort;
  // Сторы, которые умеют не только хранить, но и раздать трек пользователю (сейчас —
  // telegram-канал). Единственный источник cache-hit и доставки.
  caches: ResourceCachePort[];
  // Сторы только для хранения (например fs-архив) — участвуют лишь в save().
  archives: ResourceStorePort[];
  notifier: NotifierPort;
  errorLog: ErrorLogRepository;
  // Files above this are rejected as BlockReason.TooLarge (the limit itself — Telegram Bot API —
  // is an infrastructure fact, so it is injected, not read from config here).
  maxFileSizeBytes: number;
  // Playlist fan-out spawns brand-new queue jobs (application-owned, generic) that still
  // need a telegram delivery target when they complete independently later. Registering
  // that target is a telegram-infra concern, so it's injected as an opaque callback —
  // application never touches telegram_reply_refs directly.
  registerPlaylistEntryOrigin: (childJobId: number, userId: number) => Promise<void>;
}

export type ProcessDownloadJobFn = (job: QueueItem, log: WorkerLog) => Promise<void>;

export function createProcessDownloadJob(deps: ProcessDownloadJobDeps): ProcessDownloadJobFn {
  async function logError(jobId: number, url: string, error: string) {
    await deps.errorLog.add(jobId, url, error);
  }

  // Terminal, non-retryable failure: record it, mark the job failed with its blockReason,
  // tell the user. The caller must return true so the job isn't also marked 'done'.
  async function failPermanently(job: QueueItem, result: Extract<DownloadResult, { ok: false }>, log: WorkerLog) {
    log.error(`job ${job.id} | permanent failure | blockReason=${result.blockReason ?? "-"} | ${result.error.split("\n")[0]}`);
    await logError(job.id, job.url, result.error);
    await deps.queue.updateStatus(job.id, QueueStatus.Failed, {
      error: result.error,
      blockReason: result.blockReason ?? null,
    });
    await deps.notifier.notify(job.id, result);
  }

  // Только find — ничего не отправляет, просто отвечает "есть готовая к раздаче копия?".
  // Смотрит только caches (сейчас — telegram); fs-архив тут не участвует: найти
  // локальную копию не значит суметь её раздать (доставка всё равно только через
  // Telegram), локальная копия — архив, не источник дедупа, см. docs/specs/types.md.
  // Сам deliver() вызывающий код делает отдельным явным шагом — не спрятан внутри find.
  async function findDeliverable(resourceId: string): Promise<{ store: ResourceCachePort; resource: Resource } | null> {
    for (const store of deps.caches) {
      const resource = await store.find(resourceId);
      if (resource) return { store, resource };
    }
    return null;
  }

  async function handlePlaylist(job: QueueItem, entries: Resource[], log: WorkerLog) {
    let cached = 0;
    let queued = 0;

    for (const entry of entries) {
      const hit = await findDeliverable(entry.resourceId);
      if (hit) {
        await hit.store.deliver(hit.resource, job.id);
        cached++;
        continue;
      }

      const existing = await deps.queue.findPendingByResourceId(entry.resourceId);
      if (!existing) {
        const childId = await deps.queue.enqueue({
          url: entry.url,
          userId: job.userId,
          resourceId: entry.resourceId,
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
    let resourceId = job.resourceId;
    let url = job.url;

    if (!resourceId) {
      const info = await deps.downloader.getInfo(url);

      if ("entries" in info) {
        log.info(`job ${job.id} | playlist | ${info.entries.length} entries`);
        await handlePlaylist(job, info.entries, log);
        return false;
      }

      resourceId = info.resourceId;
      url = info.url;
    }

    const hit = await findDeliverable(resourceId);
    if (hit) {
      log.info(`job ${job.id} | cache hit | resource_id=${resourceId}`);
      await hit.store.deliver(hit.resource, job.id);
      return false;
    }

    log.info(`job ${job.id} | downloading | ${url}`);
    const result = await deps.downloader.download(url);

    if (!result.ok) {
      await failPermanently(job, result, log);
      return true;
    }

    log.info(`job ${job.id} | downloaded | ${result.resource.title}`);

    const fileSize = Bun.file(result.filePath).size;
    if (fileSize > deps.maxFileSizeBytes) {
      const limitMb = Math.round(deps.maxFileSizeBytes / 1024 / 1024);
      await unlink(result.filePath).catch(() => {});
      log.warn(`job ${job.id} | skipped — exceeds ${limitMb}MB | ${result.resource.title}`);
      await failPermanently(
        job,
        {
          ok: false,
          error: `Трек "${result.resource.title}" превышает лимит ${limitMb}MB и был пропущен`,
          blockReason: BlockReason.TooLarge,
          retryable: false,
        },
        log
      );
      return true;
    }

    log.info(`job ${job.id} | storing (${deps.caches.length + deps.archives.length} backend(s))`);
    let delivered = false;
    for (const store of deps.caches) {
      log.info(`job ${job.id} | store=${store.name} | save start`);
      await store.save(result.resource, result.filePath);
      log.info(`job ${job.id} | store=${store.name} | save done`);
      log.info(`job ${job.id} | store=${store.name} | deliver start`);
      await store.deliver(result.resource, job.id);
      log.info(`job ${job.id} | store=${store.name} | deliver done`);
      delivered = true;
    }
    for (const store of deps.archives) {
      log.info(`job ${job.id} | store=${store.name} | save start`);
      await store.save(result.resource, result.filePath);
      log.info(`job ${job.id} | store=${store.name} | save done`);
    }

    // Ни один cache не доставил (например только fs-архив без Telegram-кэша) —
    // шлём свежескачанные байты напрямую через NotifierPort.
    if (!delivered) {
      log.info(`job ${job.id} | sending directly to user (no deliverable store)`);
      await deps.notifier.notify(job.id, result);
    }

    // Все ResourceStorePort.save() только читают/копируют исходник, никогда не забирают
    // владение им (см. docs/specs/types.md) — временный файл всегда чистим сами.
    await unlink(result.filePath).catch(() => {});

    return false;
  }

  return async function processDownloadJob(job, log) {
    try {
      const finalized = await runJob(job, log);
      if (!finalized) {
        await deps.queue.updateStatus(job.id, QueueStatus.Done);
        log.info(`job ${job.id} | done`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await logError(job.id, job.url, error);

      // Off-by-one fix (plan decision #6): exhausted is checked on retries *already
      // spent*, so all three backoffs (30s/60s/120s) fire before the job is failed.
      const exhausted = job.retries >= MAX_RETRIES;

      log.error(`job ${job.id} | attempt ${job.retries + 1} | exhausted=${exhausted} | ${error.split("\n")[0]}`);

      if (exhausted) {
        await deps.queue.updateStatus(job.id, QueueStatus.Failed, { error });
        await deps.notifier.notify(job.id, { ok: false, error, retryable: false });
      } else {
        const delaySeconds = backoffSeconds(job.retries);
        const retryAt = Math.floor(Date.now() / 1000) + delaySeconds;
        await deps.queue.updateStatus(job.id, QueueStatus.Pending, {
          retries: job.retries + 1,
          error,
          retryAfter: retryAt,
        });
        log.info(`job ${job.id} | requeued for retry in ${delaySeconds}s`);
      }
    }
  };
}
