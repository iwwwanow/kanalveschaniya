import { unlink } from "fs/promises";
import { type QueueItem, type QueueRepository, QueueStatus, MAX_RETRIES, backoffSeconds } from "../domain/queue";
import { BlockReason } from "../domain/block-reason";
import type { Resource } from "../domain/resource";
import type { DownloaderPort, DownloadResult } from "../domain/download";
import type { ErrorLogRepository } from "../domain/error-log";
import type { NotifierPort } from "../domain/notifier";
import type { ResourceArchivePort, ResourceCachePort } from "../domain/resource-cache";
import type { WorkerLog } from "./worker-log";

export interface ProcessDownloadJobDeps {
  queue: QueueRepository;
  downloader: DownloaderPort;
  // Сторы, которые умеют не только хранить, но и раздать трек пользователю (сейчас —
  // telegram-канал). Единственный источник cache-hit и доставки.
  caches: ResourceCachePort[];
  // Архивы (например fs): сохраняют копию и могут отдать файл обратно (findFile) — дедуп без скачивания.
  archives: ResourceArchivePort[];
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
  // Смотрит только caches (сейчас — telegram): они раздают сами. Сам deliver() вызывающий
  // код делает отдельным явным шагом — не спрятан внутри find.
  async function findDeliverable(resourceId: string): Promise<{ store: ResourceCachePort; resource: Resource } | null> {
    for (const store of deps.caches) {
      const resource = await store.find(resourceId);
      if (resource) return { store, resource };
    }
    return null;
  }

  // Ресурс уже есть у нас — отдать его пользователю без скачивания: сначала из cache
  // (deliver), затем из архива (файл с диска через NotifierPort). Файл архива не удаляем.
  async function deliverExisting(job: QueueItem, resourceId: string, log: WorkerLog): Promise<boolean> {
    const hit = await findDeliverable(resourceId);
    if (hit) {
      log.info(`job ${job.id} | cache hit | resource_id=${resourceId}`);
      await hit.store.deliver(hit.resource, job.id);
      return true;
    }
    for (const archive of deps.archives) {
      const found = await archive.findFile(resourceId);
      if (!found) continue;
      log.info(`job ${job.id} | archive hit (${archive.name}) | resource_id=${resourceId}`);
      await deps.notifier.notify(job.id, { ok: true, resource: found.resource, filePath: found.filePath });
      return true;
    }
    return false;
  }

  async function handlePlaylist(job: QueueItem, entries: Resource[], log: WorkerLog) {
    let cached = 0;
    let queued = 0;

    for (const entry of entries) {
      if (await deliverExisting(job, entry.resourceId, log)) {
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
      await deps.queue.setResourceId(job.id, resourceId);
    }

    if (await deliverExisting(job, resourceId, log)) return false;

    log.info(`job ${job.id} | downloading | ${url}`);
    const result = await deps.downloader.download(url);

    if (!result.ok) {
      // retryable -> hand it to the retry/backoff path in processDownloadJob's catch (same
      // as any thrown error); otherwise it is terminal.
      if (result.retryable) throw new Error(result.error);
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
          error: `"${result.resource.title}" exceeds the ${limitMb}MB upload limit`,
          resource: result.resource,
          blockReason: BlockReason.TooLarge,
          retryable: false,
        },
        log
      );
      return true;
    }

    log.info(`job ${job.id} | storing (${deps.caches.length + deps.archives.length} backend(s))`);
    // Delivery to the user decides the job's fate; the archive is a secondary copy. A failing
    // backend must not stop the others, and a failing archive must not re-run a delivery that
    // already reached the user (the retry would send the file again).
    const deliveryErrors: string[] = [];
    try {
      for (const store of deps.caches) {
        try {
          log.info(`job ${job.id} | store=${store.name} | save start`);
          await store.save(result.resource, result.filePath, job.id);
          log.info(`job ${job.id} | store=${store.name} | save done`);
        } catch (err) {
          deliveryErrors.push(`${store.name} save: ${errorMessage(err)}`);
          continue; // deliver only what this store actually saved
        }
        try {
          log.info(`job ${job.id} | store=${store.name} | deliver start`);
          await store.deliver(result.resource, job.id);
          log.info(`job ${job.id} | store=${store.name} | deliver done`);
        } catch (err) {
          deliveryErrors.push(`${store.name} deliver: ${errorMessage(err)}`);
        }
      }

      for (const store of deps.archives) {
        try {
          log.info(`job ${job.id} | store=${store.name} | save start`);
          await store.save(result.resource, result.filePath, job.id);
          log.info(`job ${job.id} | store=${store.name} | save done`);
        } catch (err) {
          const message = `archive ${store.name} save failed: ${errorMessage(err)}`;
          log.warn(`job ${job.id} | ${message}`);
          await logError(job.id, job.url, message);
        }
      }

      // Без caches (например только fs-архив) доставить некому — шлём свежескачанные байты
      // напрямую через NotifierPort. Если cache был, но упал, напрямую не шлём: ретрай доставит.
      if (deps.caches.length === 0) {
        try {
          log.info(`job ${job.id} | sending directly to user (no deliverable store)`);
          await deps.notifier.notify(job.id, result);
        } catch (err) {
          deliveryErrors.push(`notify: ${errorMessage(err)}`);
        }
      }
    } finally {
      // Все ResourceStorePort.save() только читают/копируют исходник, никогда не забирают
      // владение им (см. docs/specs/types.md) — временный файл всегда чистим сами.
      await unlink(result.filePath).catch(() => {});
    }

    if (deliveryErrors.length > 0) throw new Error(deliveryErrors.join("; "));

    return false;
  }

  return async function processDownloadJob(job, log) {
    try {
      const finalized = await runJob(job, log);
      if (!finalized) {
        // a job that got here after failed attempts must not keep their error/block_reason
        await deps.queue.updateStatus(job.id, QueueStatus.Done, { error: null, blockReason: null });
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
