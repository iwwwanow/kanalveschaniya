import type { Resource } from "./resource";
import type { BlockReason } from "./block-reason";

export type DownloadResult =
  | { ok: true; resource: Resource; filePath: string }
  // retryable: true — transient, the queue retries with backoff; false — terminal (failed at once).
  // resource: set when the failure concerns a known resource (e.g. too_large), for the user-facing text.
  | { ok: false; error: string; blockReason?: BlockReason; retryable: boolean; resource?: Resource };

export interface DownloaderPort {
  getInfo(url: string): Promise<{ entries: Resource[] } | Resource>;
  download(url: string): Promise<DownloadResult>;
}
