import { unlink } from "fs/promises";
import { MAX_RETRIES, QueueStatus, backoffSeconds } from "../domain/queue";
import type { QueueItem, QueueRepository } from "../domain/queue";
import { BlockReason } from "../domain/block-reason";
import type { NotifierPort } from "../domain/notifier";
import type { WorkerLog } from "./worker-log";

export interface RecoverStuckJobsDeps {
  queue: QueueRepository;
  notifier: NotifierPort;
}

export type RecoverStuckJobsFn = (log: WorkerLog) => Promise<void>;

// Startup-only. A job stuck in 'processing' (download) or 'delivering' means the whole process
// died mid-way (OOM-kill, pod restart from a stuck liveness probe) — the in-process catch in
// download-job.ts / deliver-job.ts never ran, so the stage's attempt counter was never
// incremented and the normal exhaustion check never fired. Without this, a resource whose own
// download or delivery crashes the process retries forever: crash -> reset -> claimed again ->
// crashes again, no cap. Counting the crash itself as an attempt closes that loop.
export function createRecoverStuckJobs(deps: RecoverStuckJobsDeps): RecoverStuckJobsFn {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  async function giveUp(job: QueueItem, attempts: number, counters: Partial<QueueItem>, log: WorkerLog) {
    const error = `the process crashed while handling this job ${attempts} time(s) — giving up`;
    await deps.queue.updateStatus(job.id, QueueStatus.Failed, {
      ...counters,
      error,
      blockReason: BlockReason.CrashedRepeatedly,
      filePath: null,
    });
    await deps.notifier.notify(job.id, { ok: false, error, retryable: false, blockReason: BlockReason.CrashedRepeatedly });
    if (job.filePath) await unlink(job.filePath).catch(() => {});
    log.error(`job ${job.id} | crashed_repeatedly | exhausted after ${attempts} crash(es)`);
  }

  return async function recoverStuckJobs(log) {
    for (const job of await deps.queue.findStuckProcessing()) {
      const retries = job.retries + 1;
      if (retries >= MAX_RETRIES) {
        await giveUp(job, retries, { retries }, log);
      } else {
        const retryAfter = nowSeconds() + backoffSeconds(retries);
        await deps.queue.updateStatus(job.id, QueueStatus.Pending, { retries, retryAfter });
        log.warn(`job ${job.id} | recovered from crash | download attempt ${retries + 1} in ${backoffSeconds(retries)}s`);
      }
    }

    // The file is already downloaded and staged: only the delivery is retried.
    for (const job of await deps.queue.findStuckDelivering()) {
      const deliverRetries = job.deliverRetries + 1;
      if (deliverRetries >= MAX_RETRIES) {
        await giveUp(job, deliverRetries, { deliverRetries }, log);
      } else {
        const deliverRetryAfter = nowSeconds() + backoffSeconds(deliverRetries);
        await deps.queue.updateStatus(job.id, QueueStatus.Downloaded, { deliverRetries, deliverRetryAfter });
        log.warn(`job ${job.id} | recovered from crash | delivery attempt ${deliverRetries + 1} in ${backoffSeconds(deliverRetries)}s`);
      }
    }
  };
}
