import { MAX_RETRIES, QueueStatus, backoffSeconds } from "../domain/queue";
import type { QueueRepository } from "../domain/queue";
import { BlockReason } from "../domain/block-reason";
import type { NotifierPort } from "../domain/notifier";
import type { WorkerLog } from "./worker-log";

export interface RecoverStuckJobsDeps {
  queue: QueueRepository;
  notifier: NotifierPort;
}

export type RecoverStuckJobsFn = (log: WorkerLog) => Promise<void>;

// Startup-only. A job stuck in 'processing' means the whole process died mid-download
// (OOM-kill, pod restart from a stuck liveness probe) — the in-process catch in
// process-download-job.ts never ran, so `retries` was never incremented and the normal
// exhaustion check never fired. Without this, a track whose own download crashes the
// process retries forever: crash -> reset to pending -> claimed again -> crashes again,
// no cap. Counting the crash itself as an attempt closes that loop.
export function createRecoverStuckJobs(deps: RecoverStuckJobsDeps): RecoverStuckJobsFn {
  return async function recoverStuckJobs(log) {
    const stuck = await deps.queue.findStuckProcessing();
    if (stuck.length === 0) return;

    for (const job of stuck) {
      const retries = job.retries + 1;

      if (retries >= MAX_RETRIES) {
        const error = "Скачивание несколько раз подряд приводило к сбою процесса — попытки прекращены.";
        await deps.queue.updateStatus(job.id, QueueStatus.Failed, {
          retries,
          error,
          blockReason: BlockReason.CrashedRepeatedly,
        });
        await deps.notifier.notify(job.id, {
          ok: false,
          error,
          retryable: false,
          blockReason: BlockReason.CrashedRepeatedly,
        });
        log.error(`job ${job.id} | crashed_repeatedly | exhausted after ${retries} crash(es)`);
      } else {
        const retryAfter = Math.floor(Date.now() / 1000) + backoffSeconds(retries);
        await deps.queue.updateStatus(job.id, QueueStatus.Pending, { retries, retryAfter });
        log.warn(`job ${job.id} | recovered from crash | attempt ${retries + 1} in ${backoffSeconds(retries)}s`);
      }
    }
  };
}
