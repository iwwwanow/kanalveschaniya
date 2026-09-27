// A job goes through two stages, each with its own in-flight state and retry budget:
//   download: pending -> processing -> downloaded   (the file is staged on disk)
//   deliver:  downloaded -> delivering -> done      (stores + sending to the user)
// so a failing delivery is retried without downloading the resource again.
//
// Shared kernel between core and session-service (see queue-table.ts) — session-service only
// ever reads this column (to tell a resource job apart from a terminal `failed` one before
// deciding to requeue it), it never writes it.
export enum QueueStatus {
  Pending = "pending",
  Processing = "processing", // download in flight
  Downloaded = "downloaded", // file staged (core's QueueItem.filePath), waiting for delivery
  Delivering = "delivering", // delivery in flight
  Done = "done",
  Failed = "failed",
}
