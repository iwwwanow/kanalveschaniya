import type { DownloadResult } from "./download";

export interface PlaylistQueuedSummary {
  queued: number;
  cached: number;
}

export interface NotifierPort {
  notify(jobId: number, result: DownloadResult): Promise<void>;
  // Not in docs/specs/types.md draft — added because playlist fan-out has no single
  // Track/DownloadResult to report; see final report for rationale.
  notifyPlaylistQueued(jobId: number, summary: PlaylistQueuedSummary): Promise<void>;
}
