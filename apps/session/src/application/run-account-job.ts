import { MAX_RETRIES, backoffSeconds } from "shared-queue";
import type { TaggedLog } from "shared-logger";
import { AccountJobStatus, type AccountJob, type AccountJobRepository } from "../domain/account-job";
import type { AccountRepository } from "../domain/account";
import type { ProxyRepository } from "../domain/proxy";
import type { CookieRepository } from "../domain/cookie";
import type { BrowserEmulatorPort } from "../domain/browser-emulator";
import { encryptCookie } from "../infrastructure/adapters/cookie-cipher";
import type { RequeueBlockedByServiceFn } from "./requeue-blocked-by-service";

export interface RunAccountJobDeps {
  accountJobs: AccountJobRepository;
  accounts: AccountRepository;
  proxies: ProxyRepository;
  cookies: CookieRepository;
  browserEmulator: BrowserEmulatorPort;
  requeueBlockedByService: RequeueBlockedByServiceFn;
  encryptionKey: string;
  requeueStaggerSeconds: number;
}

export type RunAccountJobFn = (job: AccountJob, log: TaggedLog) => Promise<void>;

// One attempt at a cookie refresh, claimed by account-job-poller.ts. Mirrors the shape of core's
// download-job.ts (same MAX_RETRIES/backoffSeconds budget, same ok/retryable branching) but for a
// single-stage job with no delivery split.
export function createRunAccountJob(deps: RunAccountJobDeps): RunAccountJobFn {
  return async function runAccountJob(job, log) {
    const account = await deps.accounts.findById(job.accountId);
    if (!account) {
      // The account row is gone (shouldn't happen outside manual DB surgery) — nothing to retry.
      log.error(`account_job ${job.id} | account ${job.accountId} not found, failing job`);
      await deps.accountJobs.updateStatus(job.id, AccountJobStatus.Failed, { error: "account not found" });
      return;
    }

    const proxy = account.proxyId ? await deps.proxies.findById(account.proxyId) : null;
    const result = await deps.browserEmulator.login(account, proxy);

    if (result.ok) {
      const encrypted = encryptCookie(result.cookieBlob, deps.encryptionKey);
      await deps.cookies.upsert(account.id, encrypted);
      await deps.accounts.markActive(account.id);
      await deps.accountJobs.updateStatus(job.id, AccountJobStatus.Done, { error: null });
      log.info(`account_job ${job.id} | account ${account.id} | cookie refreshed`);
      await deps.requeueBlockedByService({ serviceId: account.serviceId, staggerSeconds: deps.requeueStaggerSeconds });
      return;
    }

    if (!result.retryable) {
      log.error(`account_job ${job.id} | account ${account.id} | non-retryable: ${result.error}`);
      await deps.accounts.markBanned(account.id);
      await deps.accountJobs.updateStatus(job.id, AccountJobStatus.Failed, { error: result.error });
      return;
    }

    // Off-by-one avoided the same way core's download-job.ts does it: exhausted is checked on
    // retries already spent, so all MAX_RETRIES backoffs fire before the account is banned.
    const exhausted = job.retries >= MAX_RETRIES;
    log.warn(`account_job ${job.id} | account ${account.id} | attempt ${job.retries + 1} | exhausted=${exhausted} | ${result.error}`);

    if (exhausted) {
      await deps.accounts.markBanned(account.id);
      await deps.accountJobs.updateStatus(job.id, AccountJobStatus.Failed, { error: result.error });
      return;
    }

    const delaySeconds = backoffSeconds(job.retries);
    const retryAfter = Math.floor(Date.now() / 1000) + delaySeconds;
    await deps.accountJobs.updateStatus(job.id, AccountJobStatus.Pending, {
      retries: job.retries + 1,
      retryAfter,
      error: result.error,
    });
  };
}
