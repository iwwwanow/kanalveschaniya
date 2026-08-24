export type QueueStatus = "pending" | "processing" | "done" | "failed";

export interface QueueItem {
  id: number;
  url: string;
  trackId: string | null; // null until a playlist/single URL is resolved via DownloaderPort.getInfo
  userId: number;
  status: QueueStatus;
  error: string | null;
  blockReason: string | null; // opaque for domain/application — see docs/specs/types.md
  retries: number; // generic queue bookkeeping, needed by application's backoff logic
  retryAfter: number | null; // unix timestamp; job not claimable before this time
  createdAt: number;
}

export interface QueueRepository {
  enqueue(item: Pick<QueueItem, "url" | "userId"> & Partial<Pick<QueueItem, "trackId">>): Promise<number>;
  findPendingByUrl(url: string): Promise<QueueItem | null>;
  findPendingByTrackId(trackId: string): Promise<QueueItem | null>;
  claim(): Promise<QueueItem | null>;
  updateStatus(id: number, status: QueueStatus, patch?: Partial<QueueItem>): Promise<void>;
  requeueByBlockReason(reason: string, newStatus: QueueStatus): Promise<void>;
  countByStatusForUser(userId: number): Promise<Record<string, number>>;
}
