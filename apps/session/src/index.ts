// Public API of session-service, consumed by apps/core/src/main.ts — the composition root for the
// whole process (core and session-service run in one process for now, see
// docs/specs/session-app.specs.md). Flat named exports, same composition style core's own main.ts
// uses for its own pieces (createDownloadJob, createDeliverJob, ...), not one aggregate object.

export { openSessionDb } from "./infrastructure/db/session-db";

export { createServicesRepository } from "./infrastructure/repository/services-repository";
export { createAccountsRepository } from "./infrastructure/repository/accounts-repository";
export { createProxiesRepository } from "./infrastructure/repository/proxies-repository";
export { createCookiesRepository } from "./infrastructure/repository/cookies-repository";
export { createAccountJobsRepository } from "./infrastructure/repository/account-jobs-repository";

export { createStubBrowserEmulator } from "./infrastructure/adapters/stub-browser-emulator";

export { createSessionContext, type SessionContextDeps } from "./application/session-context";
export { createEnsureAccountJobs, type EnsureAccountJobsDeps } from "./application/ensure-account-jobs";
export { createRunAccountJob, type RunAccountJobDeps } from "./application/run-account-job";
export { createRequeueBlockedByService } from "./application/requeue-blocked-by-service";

export { startAccountJobPoller, type AccountJobPollerDeps } from "./infrastructure/workers/account-job-poller";

export type { QueueSignalPort } from "./domain/queue-signal";
