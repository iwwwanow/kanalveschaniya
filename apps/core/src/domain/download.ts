import type { Resource } from "./resource";
import type { BlockReason } from "shared-queue";

export type DownloadResult =
  | { ok: true; resource: Resource; filePath: string }
  // retryable: true — transient, the queue retries with backoff; false — terminal (failed at once).
  // resource: set when the failure concerns a known resource (e.g. too_large), for the user-facing text.
  | { ok: false; error: string; blockReason?: BlockReason; retryable: boolean; resource?: Resource };

export interface DownloadOptions {
  // Set by download-job.ts's resolve-stage preflight when the resource's service requires a
  // cookie — a decrypted, materialized-to-disk file (yt-dlp's `--cookies` takes a path, not a
  // string). Not addressed here (see docs/specs/session-app.specs.md's open questions): the
  // account's own proxy is NOT wired into this call — proxy-per-download stays the global
  // config.proxy flag it already is.
  cookieFilePath?: string;
}

export interface DownloaderPort {
  getInfo(url: string): Promise<{ entries: Resource[] } | Resource>;
  download(url: string, options?: DownloadOptions): Promise<DownloadResult>;
}
