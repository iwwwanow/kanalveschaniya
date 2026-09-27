import type { Account } from "./account";
import type { Proxy } from "./proxy";

// The vendor boundary: cookie acquisition/refresh is done by a third-party browser-emulation
// service, not written in-house. Which vendor, and how to tell "their transient failure" apart
// from "the account is genuinely banned by the platform", is an open question (see
// docs/specs/session-app.specs.md) — infrastructure/adapters/stub-browser-emulator.ts is the
// placeholder implementation until one is picked.
export type LoginResult =
  | { ok: true; cookieBlob: string }
  // Same ok/retryable shape as core's DownloadResult — retryable: true goes through the
  // account_job's own retry/backoff budget, false marks the account banned right away.
  | { ok: false; error: string; retryable: boolean };

export interface BrowserEmulatorPort {
  login(account: Account, proxy: Proxy | null): Promise<LoginResult>;
}
