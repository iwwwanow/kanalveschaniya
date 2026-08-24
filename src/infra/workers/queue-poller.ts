import { logger } from "../../logger";
import { config } from "../../config";
import type { QueueRepository } from "../../domain/queue";
import type { ProcessDownloadJobFn, WorkerLog } from "../../application/process-download-job";

export function startQueuePoller(queue: QueueRepository, processDownloadJob: ProcessDownloadJobFn): void {
  for (let i = 1; i <= config.workerConcurrency; i++) {
    runWorker(queue, processDownloadJob, i);
  }
  logger.info(`${config.workerConcurrency} workers started`);
}

async function runWorker(queue: QueueRepository, process: ProcessDownloadJobFn, workerId: number) {
  const log: WorkerLog = logger.worker(workerId);
  log.info("started");

  while (true) {
    try {
      await workerLoop(queue, process, log);
    } catch (err) {
      log.error("unexpected crash, restarting in 5s:", err);
      await Bun.sleep(5_000);
    }
  }
}

async function workerLoop(queue: QueueRepository, process: ProcessDownloadJobFn, log: WorkerLog) {
  while (true) {
    const job = await queue.claim();

    if (!job) {
      await Bun.sleep(config.workerIntervalMs);
      continue;
    }

    log.info(`job ${job.id} | ${job.url}`);
    // process() never throws — it owns the job's full retry/failure lifecycle
    // (application/process-download-job.ts). This loop only claims and dispatches, no
    // direct Telegraf calls (audit finding #3).
    await process(job, log);
  }
}
