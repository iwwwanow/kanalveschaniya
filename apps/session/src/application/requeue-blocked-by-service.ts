import { BlockReason, QueueStatus } from "shared-queue";
import type { QueueSignalPort } from "../domain/queue-signal";

export interface RequeueBlockedByServiceInput {
  serviceId: number;
  staggerSeconds: number;
}

export type RequeueBlockedByServiceFn = (input: RequeueBlockedByServiceInput) => Promise<void>;

// Analogous to core's own requeue-blocked-jobs.ts, but triggered by an account becoming usable
// again (run-account-job.ts, on a successful cookie refresh) instead of at process startup, and
// scoped to one service — a different service's needs_cookie jobs are left alone.
export function createRequeueBlockedByService(queueSignal: QueueSignalPort): RequeueBlockedByServiceFn {
  return ({ serviceId, staggerSeconds }) =>
    queueSignal.requeueByBlockReason(BlockReason.NeedsCookie, QueueStatus.Pending, staggerSeconds, serviceId);
}
