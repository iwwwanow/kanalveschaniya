import type { DownloadResult } from "../domain/download";
import type { ErrorLogRepository } from "../domain/error-log";
import type { NotifierPort } from "../domain/notifier";
import { type QueueItem, type QueueRepository, QueueStatus } from "../domain/queue";
import type { WorkerLog } from "./worker-log";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface FailJobDeps {
  queue: QueueRepository;
  errorLog: ErrorLogRepository;
  notifier: NotifierPort;
}

// Terminal, non-retryable failure: record it, mark the job failed with its blockReason,
// tell the user. The caller must not write another status afterwards.
export async function failJob(
  deps: FailJobDeps,
  job: QueueItem,
  result: Extract<DownloadResult, { ok: false }>,
  log: WorkerLog,
): Promise<void> {
  log.error(`job ${job.id} | permanent failure | blockReason=${result.blockReason ?? "-"} | ${result.error.split("\n")[0]}`);
  await deps.errorLog.add(job.id, job.url, result.error);
  await deps.queue.updateStatus(job.id, QueueStatus.Failed, {
    error: result.error,
    blockReason: result.blockReason ?? null,
    filePath: null,
  });
  await deps.notifier.notify(job.id, result);
}
