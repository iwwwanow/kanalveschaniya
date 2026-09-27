// Why a job was permanently stopped instead of being retried. Persisted as its string value in
// queue.block_reason — the values are the pre-enum literals, so no DB migration.
export enum BlockReason {
  Geo = "geo",
  Drm = "drm",
  TooLarge = "too_large", // the downloaded file exceeds the upload limit
  TooLong = "too_long", // predicted before downloading: the duration alone won't fit the limit
  CrashedRepeatedly = "crashed_repeatedly",
}

// For values read back from the DB (plain string column) — unknown value -> null, so a stray
// row can't leak a non-member into the domain as if it were a valid BlockReason.
export function parseBlockReason(value: string | null): BlockReason | null {
  return Object.values(BlockReason).find((r) => r === value) ?? null;
}
