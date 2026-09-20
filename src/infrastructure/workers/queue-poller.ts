import { logger } from "../../logger";
import { config } from "../../config";
import type { QueueItem, QueueRepository } from "../../domain/queue";
import type { DownloadJobFn } from "../../application/download-job";
import type { DeliverJobFn } from "../../application/deliver-job";
import type { WorkerLog } from "../../application/worker-log";

export interface QueuePollerDeps {
  queue: QueueRepository;
  downloadJob: DownloadJobFn;
  deliverJob: DeliverJobFn;
}

type JobFn = (job: QueueItem, log: WorkerLog) => Promise<void>;

// Two independent pools over the same queue: downloaders claim `pending` jobs, deliverers claim
// `downloaded` ones (the file is already on disk), so delivery retries never wait for — or repeat —
// a download.
export function startQueuePollers(deps: QueuePollerDeps): void {
  let workerId = 0;
  const start = (count: number, claim: () => Promise<QueueItem | null>, run: JobFn) => {
    for (let i = 0; i < count; i++) runWorker(++workerId, claim, run);
  };

  start(config.workerConcurrency, () => deps.queue.claim(), deps.downloadJob);
  start(config.deliverConcurrency, () => deps.queue.claimForDelivery(), deps.deliverJob);
  logger.info(`${config.workerConcurrency} download + ${config.deliverConcurrency} delivery workers started`);
}

async function runWorker(workerId: number, claim: () => Promise<QueueItem | null>, run: JobFn) {
  const log: WorkerLog = logger.worker(workerId);
  log.info("started");

  while (true) {
    try {
      await workerLoop(claim, run, log);
    } catch (err) {
      log.error("unexpected crash, restarting in 5s:", err);
      await Bun.sleep(5_000);
    }
  }
}

async function workerLoop(claim: () => Promise<QueueItem | null>, run: JobFn, log: WorkerLog) {
  while (true) {
    const job = await claim();

    if (!job) {
      await Bun.sleep(config.workerIntervalMs);
      continue;
    }

    log.info(`job ${job.id} | ${job.url}`);
    // run() never throws — it owns the job's full retry/failure lifecycle for its stage
    // (application/download-job.ts, deliver-job.ts). This loop only claims and dispatches, no
    // direct Telegraf calls (audit finding #3).
    await run(job, log);
  }
}
