// Pure, table-agnostic retry budget — shared between core's queue jobs and session-service's
// account_jobs (packages/shared-queue is the natural home: no dependency, and both job kinds want
// the exact same backoff curve, not two copies that could drift apart).

// Shared with the crash-recovery path (core's infra/workers/recover-stuck-jobs.ts) so a process
// crash mid-download counts as an attempt the same way an in-process failure does — otherwise a
// resource whose download crashes the whole process retries forever.
export const MAX_RETRIES = 3;

export function backoffSeconds(retries: number): number {
  return 30 * Math.pow(2, retries);
}
