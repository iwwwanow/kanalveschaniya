// Why a job was permanently stopped instead of being retried. Persisted as its string value in
// queue.block_reason — the values are the pre-enum literals, so no DB migration.
//
// Shared kernel between core and session-service: both write/read this column on the same
// `queue` table (core sets geo/drm/too_large/..., session-service sets needs_cookie and
// requeues by it once an account is usable again) — see queue-table.ts.
export enum BlockReason {
  Geo = "geo",
  Drm = "drm",
  TooLarge = "too_large", // the downloaded file exceeds the upload limit
  TooLong = "too_long", // predicted before downloading: the duration alone won't fit the limit
  CrashedRepeatedly = "crashed_repeatedly",
  // session-service: the resource's service requires a cookie and none is usable right now. Not
  // bounded by MAX_RETRIES — a resource job just sits here until session-service's account_job
  // flow gets a working account and requeues it (see docs/specs/session-app.specs.md). Note this
  // is also what a banned account looks like from the resource's side — AccountStatus.Banned is
  // an account-level terminal state, not a distinct BlockReason of its own.
  NeedsCookie = "needs_cookie",
}

// For values read back from the DB (plain string column) — unknown value -> null, so a stray
// row can't leak a non-member into the domain as if it were a valid BlockReason.
export function parseBlockReason(value: string | null): BlockReason | null {
  return Object.values(BlockReason).find((r) => r === value) ?? null;
}
