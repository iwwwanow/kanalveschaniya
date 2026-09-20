import { QueueStatus } from "../domain/queue";
import type { QueueRepository } from "../domain/queue";
import type { BlockReason } from "../domain/block-reason";

export interface RequeueBlockedJobsInput {
  reason: BlockReason;
  // Spreads retry_after across the requeued jobs (0, N, 2N, ... seconds) instead of
  // releasing them all as claimable at once.
  staggerSeconds: number;
}

export type RequeueBlockedJobsFn = (input: RequeueBlockedJobsInput) => Promise<void>;

export function createRequeueBlockedJobs(queue: QueueRepository): RequeueBlockedJobsFn {
  return ({ reason, staggerSeconds }) => queue.requeueByBlockReason(reason, QueueStatus.Pending, staggerSeconds);
}
