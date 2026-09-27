import { BlockReason } from "shared-queue";
import type { QueueSignalPort } from "../domain/queue-signal";
import type { AccountRepository } from "../domain/account";
import type { AccountJobRepository } from "../domain/account-job";

export interface EnsureAccountJobsDeps {
  queueSignal: QueueSignalPort;
  accounts: AccountRepository;
  accountJobs: AccountJobRepository;
}

export type EnsureAccountJobsFn = () => Promise<void>;

// Poller tick (see infrastructure/workers/account-job-poller.ts): for every service currently
// blocked as needs_cookie, try to start a cookie refresh. Dedup is AccountRepository's own atomic
// active->refreshing transition — this is a no-op when a refresh is already in flight, or when
// there's no active account to refresh at all (provisioning a brand-new account is a manual step,
// see domain/account.ts).
export function createEnsureAccountJobs(deps: EnsureAccountJobsDeps): EnsureAccountJobsFn {
  return async function ensureAccountJobs() {
    const serviceIds = await deps.queueSignal.findDistinctServiceIdsByBlockReason(BlockReason.NeedsCookie);
    for (const serviceId of serviceIds) {
      const account = await deps.accounts.tryStartRefresh(serviceId);
      if (account) await deps.accountJobs.enqueue(account.id);
    }
  };
}
