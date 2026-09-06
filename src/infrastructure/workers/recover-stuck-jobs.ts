import type { QueueRepository } from "../../domain/queue";
import { MAX_RETRIES, backoffSeconds } from "../../domain/queue";
import type { NotifierPort } from "../../domain/notifier";
import { logger } from "../../logger";

// Startup-only. A job stuck in 'processing' means the whole process died mid-download
// (OOM-kill, pod restart from a stuck liveness probe) — the in-process catch in
// process-download-job.ts never ran, so `retries` was never incremented and the normal
// exhaustion check never fired. Without this, a track whose own download crashes the
// process retries forever: crash -> reset to pending -> claimed again -> crashes again,
// no cap. Counting the crash itself as an attempt closes that loop.
export async function recoverStuckProcessingJobs(queue: QueueRepository, notifier: NotifierPort): Promise<void> {
  const stuck = await queue.findStuckProcessing();
  if (stuck.length === 0) return;

  for (const job of stuck) {
    const retries = job.retries + 1;

    if (retries >= MAX_RETRIES) {
      const error = "Скачивание несколько раз подряд приводило к сбою процесса — попытки прекращены.";
      await queue.updateStatus(job.id, "failed", { retries, error, blockReason: "crashed_repeatedly" });
      await notifier.notify(job.id, { ok: false, error, retryable: false, blockReason: "crashed_repeatedly" });
      logger.error(`job ${job.id} | crashed_repeatedly | exhausted after ${retries} crash(es)`);
    } else {
      const retryAfter = Math.floor(Date.now() / 1000) + backoffSeconds(retries);
      await queue.updateStatus(job.id, "pending", { retries, retryAfter });
      logger.warn(`job ${job.id} | recovered from crash | attempt ${retries + 1} in ${backoffSeconds(retries)}s`);
    }
  }
}
