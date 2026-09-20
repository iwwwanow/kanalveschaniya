import type { Track } from "./resource";
import type { BlockReason } from "./block-reason";

export type DownloadResult =
  | { ok: true; track: Track; filePath: string }
  | { ok: false; error: string; blockReason?: BlockReason; retryable: boolean };

export interface DownloaderPort {
  getInfo(url: string): Promise<{ entries: Track[] } | Track>;
  download(url: string): Promise<DownloadResult>;
}
