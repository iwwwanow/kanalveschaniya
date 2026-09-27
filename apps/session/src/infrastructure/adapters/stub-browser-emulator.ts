import type { BrowserEmulatorPort } from "../../domain/browser-emulator";

// No vendor picked yet (see docs/specs/session-app.specs.md's open questions) — an explicit
// placeholder rather than leaving BrowserEmulatorPort unimplemented. Every login attempt fails
// non-retryably, so an account_job goes straight to `failed`/account banned instead of burning
// through MAX_RETRIES against nothing. Swap this out (main.ts wiring) once a vendor is chosen.
export function createStubBrowserEmulator(): BrowserEmulatorPort {
  return {
    async login() {
      return { ok: false, error: "browser-emulator vendor not selected yet", retryable: false };
    },
  };
}
