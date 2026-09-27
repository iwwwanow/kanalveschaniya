import { unlink } from "fs/promises";
import { MAX_RETRIES, QueueStatus, backoffSeconds } from "../domain/queue";
import type { QueueItem, QueueRepository } from "../domain/queue";
import type { ErrorLogRepository } from "../domain/error-log";
import type { NotifierPort } from "../domain/notifier";
import type { Resource, ResourceRepository } from "../domain/resource";
import type { ResourceCachePort } from "../domain/resource-cache";
import { errorMessage } from "./job-support";
import type { WorkerLog } from "./worker-log";

// Stage 2 of a job: the file staged by the download stage (QueueItem.filePath) goes to the caches
// and to the user. It has its own retry budget (deliver_retries), so a failing delivery — Telegram,
// the proxy — never downloads the resource again.
export interface DeliverJobDeps {
  queue: QueueRepository;
  resources: ResourceRepository;
  caches: ResourceCachePort[];
  notifier: NotifierPort;
  errorLog: ErrorLogRepository;
}

export type DeliverJobFn = (job: QueueItem, log: WorkerLog) => Promise<void>;

export function createDeliverJob(deps: DeliverJobDeps): DeliverJobFn {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  // Throws with every backend's failure joined, after trying all of them.
  async function deliver(job: QueueItem, resource: Resource, filePath: string, log: WorkerLog) {
    const errors: string[] = [];

    for (const store of deps.caches) {
      try {
        // a retry after a delivery that failed post-save must not upload the file again
        if (!(await store.find(resource.resourceId))) {
          log.info(`job ${job.id} | store=${store.name} | save start`);
          await store.save(resource, filePath, job.id);
          log.info(`job ${job.id} | store=${store.name} | save done`);
        }
      } catch (err) {
        errors.push(`${store.name} save: ${errorMessage(err)}`);
        continue; // deliver only what this store actually holds
      }
      try {
        log.info(`job ${job.id} | store=${store.name} | deliver start`);
        await store.deliver(resource, job.id);
        log.info(`job ${job.id} | store=${store.name} | deliver done`);
      } catch (err) {
        errors.push(`${store.name} deliver: ${errorMessage(err)}`);
      }
    }

    // Без caches (например только fs-архив) доставить некому — шлём файл напрямую через
    // NotifierPort. Если cache был, но упал, напрямую не шлём: ретрай доставит.
    if (deps.caches.length === 0) {
      try {
        log.info(`job ${job.id} | sending directly to user (no deliverable store)`);
        await deps.notifier.notify(job.id, { ok: true, resource, filePath });
      } catch (err) {
        errors.push(`notify: ${errorMessage(err)}`);
      }
    }

    if (errors.length > 0) throw new Error(errors.join("; "));
  }

  // The staged file is gone (a pod restart clears the temp dir) — back to the download stage,
  // which spends one of its attempts so a file that keeps vanishing can't loop forever.
  async function requeueForDownload(job: QueueItem, log: WorkerLog) {
    const error = "the staged download is gone (temp dir cleared?) — downloading again";
    await deps.errorLog.add(job.id, job.url, error);
    if (job.retries >= MAX_RETRIES) {
      await deps.queue.updateStatus(job.id, QueueStatus.Failed, { error, filePath: null });
      await deps.notifier.notify(job.id, { ok: false, error, retryable: false });
      log.error(`job ${job.id} | staged file lost, no download attempts left`);
      return;
    }
    await deps.queue.updateStatus(job.id, QueueStatus.Pending, {
      retries: job.retries + 1,
      retryAfter: nowSeconds() + backoffSeconds(job.retries),
      filePath: null,
      deliverRetries: 0,
      deliverRetryAfter: null,
      error,
    });
    log.warn(`job ${job.id} | ${error}`);
  }

  return async function deliverJob(job, log) {
    const filePath = job.filePath;
    try {
      const resource = job.resourceId ? await deps.resources.findByResourceId(job.resourceId) : null;
      if (!filePath || !resource || !(await Bun.file(filePath).exists())) {
        await requeueForDownload(job, log);
        return;
      }

      await deliver(job, resource, filePath, log);

      await unlink(filePath).catch(() => {});
      await deps.queue.updateStatus(job.id, QueueStatus.Done, {
        error: null,
        blockReason: null,
        filePath: null,
      });
      log.info(`job ${job.id} | done`);
    } catch (err) {
      const error = errorMessage(err);
      await deps.errorLog.add(job.id, job.url, error);

      // Same rule as the download stage: exhausted is checked on attempts *already spent*.
      const exhausted = job.deliverRetries >= MAX_RETRIES;
      log.error(`job ${job.id} | delivery attempt ${job.deliverRetries + 1} | exhausted=${exhausted} | ${error.split("\n")[0]}`);

      if (exhausted) {
        if (filePath) await unlink(filePath).catch(() => {});
        await deps.queue.updateStatus(job.id, QueueStatus.Failed, { error, filePath: null });
        await deps.notifier.notify(job.id, { ok: false, error, retryable: false });
      } else {
        const delaySeconds = backoffSeconds(job.deliverRetries);
        await deps.queue.updateStatus(job.id, QueueStatus.Downloaded, {
          deliverRetries: job.deliverRetries + 1,
          deliverRetryAfter: nowSeconds() + delaySeconds,
          error,
        });
        log.info(`job ${job.id} | delivery retry in ${delaySeconds}s`);
      }
    }
  };
}
