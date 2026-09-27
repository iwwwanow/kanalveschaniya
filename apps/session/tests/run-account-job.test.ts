import { describe, expect, test } from "bun:test";
import { AccountJobStatus } from "../src/domain/account-job";
import { AccountStatus } from "../src/domain/account";
import type { BrowserEmulatorPort, LoginResult } from "../src/domain/browser-emulator";
import { createRunAccountJob } from "../src/application/run-account-job";
import { testDb, noopLog } from "./helpers";

const ENCRYPTION_KEY = "test-key-for-run-account-job";

function rig(loginResult: LoginResult) {
  const { db, accounts, proxies, cookies, accountJobs } = testDb();
  const serviceId = db.query<{ id: number }, []>(`INSERT INTO services (name, url_pattern) VALUES ('sc', 'sc.com') RETURNING id`).get()!.id;
  const accountId = db.query<{ id: number }, []>(`INSERT INTO accounts (service_id, status) VALUES (${serviceId}, 'refreshing') RETURNING id`).get()!.id;

  const browserEmulator: BrowserEmulatorPort = { login: async () => loginResult };
  const requeueCalls: Array<{ serviceId: number; staggerSeconds: number }> = [];

  const runAccountJob = createRunAccountJob({
    accountJobs,
    accounts,
    proxies,
    cookies,
    browserEmulator,
    requeueBlockedByService: async (input) => {
      requeueCalls.push(input);
    },
    encryptionKey: ENCRYPTION_KEY,
    requeueStaggerSeconds: 30,
  });

  return { db, accounts, cookies, accountJobs, accountId, serviceId, runAccountJob, requeueCalls };
}

describe("run-account-job", () => {
  test("success: stores an encrypted cookie, marks the account active, job done, requeues the service", async () => {
    const r = rig({ ok: true, cookieBlob: "raw-cookie-value" });
    const jobId = await r.accountJobs.enqueue(r.accountId);
    const job = (await r.accountJobs.claim())!;

    await r.runAccountJob(job, noopLog);

    expect((await r.accounts.findById(r.accountId))?.status).toBe(AccountStatus.Active);
    const cookie = await r.cookies.findByAccountId(r.accountId);
    expect(cookie?.blobEncrypted).not.toBe("raw-cookie-value"); // encrypted at rest
    expect(cookie?.blobEncrypted).not.toContain("raw-cookie-value");
    const row = r.db.query<{ status: string }, [number]>("SELECT status FROM account_jobs WHERE id = ?").get(jobId)!;
    expect(row.status).toBe(AccountJobStatus.Done);
    expect(r.requeueCalls).toEqual([{ serviceId: r.serviceId, staggerSeconds: 30 }]);
  });

  test("non-retryable failure: account banned immediately, job failed, no requeue", async () => {
    const r = rig({ ok: false, error: "account suspended", retryable: false });
    await r.accountJobs.enqueue(r.accountId);
    const job = (await r.accountJobs.claim())!;

    await r.runAccountJob(job, noopLog);

    expect((await r.accounts.findById(r.accountId))?.status).toBe(AccountStatus.Banned);
    const row = r.db.query<{ status: string }, [number]>("SELECT status FROM account_jobs WHERE id = ?").get(job.id)!;
    expect(row.status).toBe(AccountJobStatus.Failed);
    expect(r.requeueCalls).toEqual([]);
  });

  test("retryable failure: requeued with backoff, retries incremented, account left refreshing", async () => {
    const r = rig({ ok: false, error: "vendor timeout", retryable: true });
    await r.accountJobs.enqueue(r.accountId);
    const job = (await r.accountJobs.claim())!;

    await r.runAccountJob(job, noopLog);

    expect((await r.accounts.findById(r.accountId))?.status).toBe(AccountStatus.Refreshing);
    const row = r.db
      .query<{ status: string; retries: number; retry_after: number | null }, [number]>(
        "SELECT status, retries, retry_after FROM account_jobs WHERE id = ?",
      )
      .get(job.id)!;
    expect(row.status).toBe(AccountJobStatus.Pending);
    expect(row.retries).toBe(1);
    expect(row.retry_after).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test("retryable failure exhausting MAX_RETRIES -> account banned, job failed", async () => {
    const r = rig({ ok: false, error: "vendor timeout", retryable: true });
    await r.accountJobs.enqueue(r.accountId);
    const job = (await r.accountJobs.claim())!;
    // Simulate the job already having spent all its retries.
    await r.accountJobs.updateStatus(job.id, AccountJobStatus.Processing, { retries: 3 });
    const exhaustedJob = { ...job, retries: 3 };

    await r.runAccountJob(exhaustedJob, noopLog);

    expect((await r.accounts.findById(r.accountId))?.status).toBe(AccountStatus.Banned);
    const row = r.db.query<{ status: string }, [number]>("SELECT status FROM account_jobs WHERE id = ?").get(job.id)!;
    expect(row.status).toBe(AccountJobStatus.Failed);
  });
});
