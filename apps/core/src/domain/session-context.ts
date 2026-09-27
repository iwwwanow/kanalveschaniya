// core's own port for the one capability it needs from session-service: "does this url belong to
// a cookie-requiring service, and if so, is there a usable cookie for it right now". Defined here
// (not imported from session-service) because core must not depend on session-service's domain
// types — session-service's implementation (apps/session/src/application/session-context.ts)
// satisfies this shape structurally; apps/core/src/main.ts (the composition root for the whole
// process) wires it into download-job.ts. See docs/specs/session-app.specs.md.
export interface ServiceInfo {
  id: number;
  name: string;
  requiresCookie: boolean;
}

export interface UsableCookie {
  // Decrypted cookie, materialized to a temp file for yt-dlp's `--cookies <path>` (it takes a
  // file, not a string). Caller (download-job.ts) must call cleanup() once done with it, success
  // or failure — best-effort delete, not a secure wipe (see the open question in the spec).
  filePath: string;
  cleanup(): Promise<void>;
}

export interface SessionContextPort {
  // null: this url doesn't belong to any known service, or belongs to one that doesn't require
  // a cookie — the caller proceeds with a normal download, no session-service involvement at all.
  resolveService(url: string): Promise<ServiceInfo | null>;
  // null: the service requires a cookie but none is usable right now (no account, or one is
  // mid-refresh) — the caller fails the job as BlockReason.NeedsCookie without attempting a download.
  getUsableCookie(serviceId: number): Promise<UsableCookie | null>;
}
