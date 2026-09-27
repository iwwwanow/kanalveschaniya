// Terminal states are one-way: Refreshing -> Active|Banned, never back to Cooldown/Active from
// Banned. Cooldown exists for future rate-limit backoff (vendor-dependent, unused for now — see
// docs/specs/session-app.specs.md's open questions).
export enum AccountStatus {
  Active = "active",
  Refreshing = "refreshing", // a cookie refresh is in flight (account_job claimed) — dedup marker
  Cooldown = "cooldown", // unused in v1, reserved
  Banned = "banned", // terminal: exhausted MAX_RETRIES or a non-retryable vendor response
}

export interface Account {
  id: number;
  serviceId: number;
  status: AccountStatus;
  proxyId: number | null;
  // Opaque handle into the browser-emulator vendor's own stored profile/session — shape is
  // vendor-specific, TODO once a vendor is picked (see stub-browser-emulator.ts).
  vendorRef: string | null;
}

export interface AccountRepository {
  findActiveForService(serviceId: number): Promise<Account | null>;
  findById(id: number): Promise<Account | null>;
  // Dedup for the cookie-refresh flow: atomic `active -> refreshing`. Returns the account this
  // call won the race for, or null when there's no active account to refresh, or a refresh is
  // already in flight (0 rows affected) — either way the caller must not enqueue an account_job.
  // Only ever refreshes an already-provisioned account: provisioning a brand-new account (real
  // login credentials somewhere) is a manual step, out of scope for this automated flow.
  tryStartRefresh(serviceId: number): Promise<Account | null>;
  markActive(id: number): Promise<void>;
  markBanned(id: number): Promise<void>; // terminal
}
