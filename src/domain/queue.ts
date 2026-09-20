import type { BlockReason } from "./block-reason";

export enum QueueStatus {
  Pending = "pending",
  Processing = "processing",
  Done = "done",
  Failed = "failed",
}

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
  retries: number; // generic queue bookkeeping, needed by application's backoff logic
  retryAfter: number | null; // unix timestamp; job not claimable before this time
  createdAt: number;
}

export interface QueueRepository {
  enqueue(item: Pick<QueueItem, "url" | "userId"> & Partial<Pick<QueueItem, "resourceId">>): Promise<number>;
  findPendingByUrl(url: string): Promise<QueueItem | null>;
  findPendingByResourceId(resourceId: string): Promise<QueueItem | null>;
  claim(): Promise<QueueItem | null>;
  updateStatus(id: number, status: QueueStatus, patch?: Partial<QueueItem>): Promise<void>;
  // staggerSeconds spaces out retry_after across the matched rows (0, staggerSeconds,
  // 2*staggerSeconds, ...) instead of releasing them all as claimable at once — a
  // startup-time backlog recovery (e.g. all geo-blocked jobs once PROXY is set)
  // otherwise becomes an immediate burst of concurrent downloads right as the process
  // comes up cold. Default 0 keeps existing unstaggered behavior.
  requeueByBlockReason(reason: BlockReason, newStatus: QueueStatus, staggerSeconds?: number): Promise<void>;
  countByStatusForUser(userId: number): Promise<Record<string, number>>;
  // Jobs left in 'processing' by a run that died mid-download (OOM-kill, pod restart) —
  // never reached the in-process catch, so never got a chance to update their own status.
  // Startup-only, see infra/workers/recover-stuck-jobs.ts.
  findStuckProcessing(): Promise<QueueItem[]>;
}
