import type { BlockReason, QueueStatus } from "shared-queue";

// The narrow slice of core's queue that session-service touches — defined here (not imported from
// core) because core and session-service must not depend on each other's internals; the queue
// itself (packages/shared-queue) is the only shared contract. Core's QueueRepository happens to
// satisfy this shape structurally, and apps/core/src/main.ts (the composition root for the whole
// process — both apps run in it, see docs/specs/session-app.specs.md) passes it in directly since
// core and session-service currently share one process. When they split into separate deploys,
// only the adapter behind this port changes (e.g. an HTTP call), not session-service's logic.
export interface QueueSignalPort {
  // Distinct service ids currently blocked with the given reason — used to find which services
  // need an account_job, without knowing anything else about resource jobs.
  findDistinctServiceIdsByBlockReason(reason: BlockReason): Promise<number[]>;
  // Unblocks resource jobs blocked with `reason` for one specific service, once its account is
  // usable again. serviceId narrows it to just that service (never the whole blockReason).
  requeueByBlockReason(reason: BlockReason, newStatus: QueueStatus, staggerSeconds: number, serviceId: number): Promise<void>;
}
