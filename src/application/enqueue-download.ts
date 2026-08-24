import type { QueueRepository } from "../domain/queue";

export interface EnqueueDownloadInput {
  url: string;
  userId: number;
  trackId?: string | null;
}

export type EnqueueDownloadResult =
  | { status: "queued"; jobId: number }
  | { status: "duplicate"; jobId: number };

export type EnqueueDownloadFn = (input: EnqueueDownloadInput) => Promise<EnqueueDownloadResult>;

// Dedup semantics preserved from the pre-refactor bot/handlers.ts: a URL/trackId already
// pending or processing is not re-queued, and the second requester is NOT attached as a
// new delivery target — only the original job's reply-ref gets notified on completion.
export function createEnqueueDownload(queue: QueueRepository): EnqueueDownloadFn {
  return async function enqueueDownload(input) {
    const existing = input.trackId
      ? await queue.findPendingByTrackId(input.trackId)
      : await queue.findPendingByUrl(input.url);

    if (existing) {
      return { status: "duplicate", jobId: existing.id };
    }

    const jobId = await queue.enqueue({
      url: input.url,
      userId: input.userId,
      trackId: input.trackId ?? null,
    });

    return { status: "queued", jobId };
  };
}
