import type { Track } from "./resource";

export type DownloadResult =
  | { ok: true; track: Track; filePath: string }
  | { ok: false; error: string; blockReason?: string; retryable: boolean };

export interface DownloaderPort {
  getInfo(url: string): Promise<{ entries: Track[] } | Track>;
  download(url: string): Promise<DownloadResult>;
}
