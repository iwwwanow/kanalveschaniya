import { workerLog } from "shared-logger";
import type { AccountJobRepository } from "../../domain/account-job";
import type { EnsureAccountJobsFn } from "../../application/ensure-account-jobs";
import type { RunAccountJobFn } from "../../application/run-account-job";

export interface AccountJobPollerDeps {
  accountJobs: AccountJobRepository;
  ensureAccountJobs: EnsureAccountJobsFn;
  runAccountJob: RunAccountJobFn;
  intervalMs: number;
}

// Single worker (no ACCOUNT_JOB_CONCURRENCY — auth attempts against a browser-emulator vendor are
// likely rate-sensitive, no reason to parallelize by default). Same double-loop shape as core's
// queue-poller.ts: outer catches unexpected crashes and restarts after 5s, inner is the job loop.
// Each tick also runs ensureAccountJobs() first — cheap (a handful of rows), a no-op most ticks.
export function startAccountJobPoller(deps: AccountJobPollerDeps): void {
  const log = workerLog(1);
  log.info("session-service: account-job poller started");
  run(deps, log);
}

async function run(deps: AccountJobPollerDeps, log: ReturnType<typeof workerLog>) {
  while (true) {
    try {
      await loop(deps, log);
    } catch (err) {
      log.error("account-job poller: unexpected crash, restarting in 5s:", err);
      await Bun.sleep(5_000);
    }
  }
}

async function loop(deps: AccountJobPollerDeps, log: ReturnType<typeof workerLog>) {
  while (true) {
    await deps.ensureAccountJobs();

    const job = await deps.accountJobs.claim();
    if (!job) {
      await Bun.sleep(deps.intervalMs);
      continue;
    }

    log.info(`account_job ${job.id} | account ${job.accountId}`);
    await deps.runAccountJob(job, log);
  }
}
