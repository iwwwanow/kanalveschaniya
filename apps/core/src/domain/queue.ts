// QueueStatus and the queue table itself are the shared kernel with session-service — see
// packages/shared-queue. Everything below (QueueItem, QueueRepository, retry budget) stays
// core-only: session-service never claims/delivers a job, it only reads/requeues by BlockReason.
import { QueueStatus, type BlockReason } from "shared-queue";
export { QueueStatus };

// Shared with the crash-recovery path (infra/workers/recover-stuck-jobs.ts) so a process
// crash mid-download counts as an attempt the same way an in-process failure does —
// otherwise a resource whose download crashes the whole process retries forever.
export const MAX_RETRIES = 3;

export function backoffSeconds(retries: number): number {
  return 30 * Math.pow(2, retries);
}

export interface QueueItem {
  id: number;
  url: string;
  resourceId: string | null; // null until a playlist/single URL is resolved via DownloaderPort.getInfo
  userId: number;
  status: QueueStatus;
  error: string | null;
  blockReason: BlockReason | null;
  // Set only when blockReason is needs_cookie (session-service's resolve-stage preflight) — lets
  // session-service's requeue scan target this job's service specifically. Unset otherwise.
  serviceId: number | null;
  retries: number; // generic queue bookkeeping, needed by application's backoff logic
  retryAfter: number | null; // unix timestamp; job not claimable before this time
  filePath: string | null; // staged download, set while the job is downloaded/delivering
  deliverRetries: number; // the delivery stage's own attempt counter
  deliverRetryAfter: number | null; // unix timestamp; delivery not claimable before this time
  createdAt: number;
}

export interface QueueRepository {
  enqueue(item: Pick<QueueItem, "url" | "userId"> & Partial<Pick<QueueItem, "resourceId">>): Promise<number>;
  findPendingByUrl(url: string): Promise<QueueItem | null>;
  findPendingByResourceId(resourceId: string): Promise<QueueItem | null>;
  claim(): Promise<QueueItem | null>;
  // Next `downloaded` job whose delivery backoff has passed; marks it `delivering`.
  claimForDelivery(): Promise<QueueItem | null>;
  // Persist the id resolved via DownloaderPort.getInfo, so a retry skips that lookup.
  setResourceId(id: number, resourceId: string): Promise<void>;
  // Tags a job with the service it belongs to — currently only set at the needs_cookie preflight
  // fail path (application/download-job.ts), so requeueByBlockReason can later target just that
  // service's jobs instead of every needs_cookie job across all cookie-requiring services.
  setServiceId(id: number, serviceId: number): Promise<void>;
  updateStatus(id: number, status: QueueStatus, patch?: Partial<QueueItem>): Promise<void>;
  // staggerSeconds spaces out retry_after across the matched rows (0, staggerSeconds,
  // 2*staggerSeconds, ...) instead of releasing them all as claimable at once — a
  // startup-time backlog recovery (e.g. all geo-blocked jobs once PROXY is set)
  // otherwise becomes an immediate burst of concurrent downloads right as the process
  // comes up cold. Default 0 keeps existing unstaggered behavior.
  // serviceId: when set, only jobs tagged with that service are requeued (session-service's
  // per-service unblock) — omitted, it matches every job with that blockReason, as before
  // (core's own geo/PROXY call site).
  requeueByBlockReason(reason: BlockReason, newStatus: QueueStatus, staggerSeconds?: number, serviceId?: number): Promise<void>;
  // Distinct service ids currently blocked with the given reason — session-service's poller uses
  // this (with BlockReason.NeedsCookie) to find which services need an account_job, without
  // knowing anything about resource jobs otherwise.
  findDistinctServiceIdsByBlockReason(reason: BlockReason): Promise<number[]>;
  countByStatusForUser(userId: number): Promise<Record<string, number>>;
  // Jobs left in 'processing' by a run that died mid-download (OOM-kill, pod restart) —
  // never reached the in-process catch, so never got a chance to update their own status.
  // Startup-only, see infra/workers/recover-stuck-jobs.ts.
  findStuckProcessing(): Promise<QueueItem[]>;
  // Same for delivery: left in `delivering` by a run that died mid-send.
  findStuckDelivering(): Promise<QueueItem[]>;
}
