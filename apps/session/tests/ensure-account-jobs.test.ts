import { describe, expect, test } from "bun:test";
import { BlockReason } from "shared-queue";
import { AccountStatus } from "../src/domain/account";
import { createEnsureAccountJobs } from "../src/application/ensure-account-jobs";
import type { QueueSignalPort } from "../src/domain/queue-signal";
import { testDb } from "./helpers";

function fakeQueueSignal(serviceIds: number[]): QueueSignalPort {
  return {
    findDistinctServiceIdsByBlockReason: async (reason) => (reason === BlockReason.NeedsCookie ? serviceIds : []),
    requeueByBlockReason: async () => {},
  };
}

describe("ensure-account-jobs", () => {
  test("creates one account_job per service with an active account to refresh", async () => {
    const { db, accounts, accountJobs } = testDb();
    const serviceId = db.query<{ id: number }, []>(`INSERT INTO services (name, url_pattern) VALUES ('sc', 'sc.com') RETURNING id`).get()!.id;
    const accountId = db.query<{ id: number }, []>(`INSERT INTO accounts (service_id, status) VALUES (${serviceId}, 'active') RETURNING id`).get()!.id;

    const ensure = createEnsureAccountJobs({ queueSignal: fakeQueueSignal([serviceId]), accounts, accountJobs });
    await ensure();

    expect((await accounts.findById(accountId))?.status).toBe(AccountStatus.Refreshing);
    const job = await accountJobs.claim();
    expect(job?.accountId).toBe(accountId);
  });

  test("a service with no active account (already refreshing, or none provisioned) enqueues nothing", async () => {
    const { db, accounts, accountJobs } = testDb();
    const serviceId = db.query<{ id: number }, []>(`INSERT INTO services (name, url_pattern) VALUES ('sc', 'sc.com') RETURNING id`).get()!.id;
    db.run(`INSERT INTO accounts (service_id, status) VALUES (?, 'refreshing')`, [serviceId]);

    const ensure = createEnsureAccountJobs({ queueSignal: fakeQueueSignal([serviceId]), accounts, accountJobs });
    await ensure();

    expect(await accountJobs.claim()).toBeNull();
  });

  test("no needs_cookie signals -> no-op", async () => {
    const { accounts, accountJobs } = testDb();
    const ensure = createEnsureAccountJobs({ queueSignal: fakeQueueSignal([]), accounts, accountJobs });
    await ensure();
    expect(await accountJobs.claim()).toBeNull();
  });
});
