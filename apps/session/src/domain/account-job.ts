// One attempt to establish/refresh an account's cookie. Mirrors QueueItem's retry shape (core's
// domain/queue.ts) but is its own, simpler, single-stage job — no download/deliver split, just
// pending -> processing -> done|failed. retries/retryAfter reuse core's shared MAX_RETRIES/
// backoffSeconds (see run-account-job.ts) rather than redefining the same backoff curve.
export enum AccountJobStatus {
  Pending = "pending",
  Processing = "processing",
  Done = "done",
  Failed = "failed",
}

export interface AccountJob {
  id: number;
  accountId: number;
  status: AccountJobStatus;
  retries: number;
  retryAfter: number | null;
  error: string | null;
}

export interface AccountJobRepository {
  enqueue(accountId: number): Promise<number>;
  // Next pending job whose backoff has passed; marks it processing. Single-worker concurrency
  // (see infrastructure/workers/account-job-poller.ts) — no claim race to guard against in v1.
  claim(): Promise<AccountJob | null>;
  updateStatus(id: number, status: AccountJobStatus, patch?: Partial<AccountJob>): Promise<void>;
}
