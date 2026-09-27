import { describe, expect, test } from "bun:test";
import { AccountStatus } from "../src/domain/account";
import { AccountJobStatus } from "../src/domain/account-job";
import { servicesTable } from "../src/infrastructure/db/schema/session";
import { testDb } from "./helpers";

function seedService(db: ReturnType<typeof testDb>["db"], overrides: Partial<typeof servicesTable.$inferInsert> = {}) {
  return db
    .query<{ id: number }, []>(
      `INSERT INTO services (name, url_pattern, requires_cookie) VALUES ('${overrides.name ?? "soundcloud"}', '${overrides.urlPattern ?? "soundcloud.com"}', ${overrides.requiresCookie ? 1 : 0}) RETURNING id`,
    )
    .get()!.id;
}

function seedAccount(db: ReturnType<typeof testDb>["db"], serviceId: number, status: AccountStatus = AccountStatus.Active) {
  return db
    .query<{ id: number }, []>(`INSERT INTO accounts (service_id, status) VALUES (${serviceId}, '${status}') RETURNING id`)
    .get()!.id;
}

describe("services repository", () => {
  test("findByUrl matches by substring, case-insensitively", async () => {
    const { db, services } = testDb();
    seedService(db, { name: "soundcloud", urlPattern: "soundcloud.com", requiresCookie: true });

    const found = await services.findByUrl("https://SoundCloud.com/artist/track");
    expect(found?.name).toBe("soundcloud");
    expect(found?.requiresCookie).toBe(true);
  });

  test("findByUrl returns null for an unknown host", async () => {
    const { services } = testDb();
    expect(await services.findByUrl("https://youtube.com/watch?v=1")).toBeNull();
  });
});

describe("accounts repository: tryStartRefresh dedup", () => {
  test("flips the single active account to refreshing", async () => {
    const { db, accounts } = testDb();
    const serviceId = seedService(db);
    const accountId = seedAccount(db, serviceId);

    const started = await accounts.tryStartRefresh(serviceId);
    expect(started?.id).toBe(accountId);
    expect(started?.status).toBe(AccountStatus.Refreshing);
  });

  test("a second concurrent call finds nothing left to refresh (dedup)", async () => {
    const { db, accounts } = testDb();
    const serviceId = seedService(db);
    seedAccount(db, serviceId);

    const first = await accounts.tryStartRefresh(serviceId);
    const second = await accounts.tryStartRefresh(serviceId);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  test("no active account for the service -> null, nothing flipped", async () => {
    const { db, accounts } = testDb();
    const serviceId = seedService(db);
    seedAccount(db, serviceId, AccountStatus.Banned);

    expect(await accounts.tryStartRefresh(serviceId)).toBeNull();
  });

  test("markActive / markBanned update status", async () => {
    const { db, accounts } = testDb();
    const serviceId = seedService(db);
    const accountId = seedAccount(db, serviceId, AccountStatus.Refreshing);

    await accounts.markActive(accountId);
    expect((await accounts.findById(accountId))?.status).toBe(AccountStatus.Active);

    await accounts.markBanned(accountId);
    expect((await accounts.findById(accountId))?.status).toBe(AccountStatus.Banned);
  });
});

describe("cookies repository", () => {
  test("upsert then findByAccountId round-trips the blob, a second upsert overwrites it", async () => {
    const { db, accounts, cookies } = testDb();
    const serviceId = seedService(db);
    const accountId = seedAccount(db, serviceId);

    await cookies.upsert(accountId, "blob-v1");
    expect((await cookies.findByAccountId(accountId))?.blobEncrypted).toBe("blob-v1");

    await cookies.upsert(accountId, "blob-v2");
    expect((await cookies.findByAccountId(accountId))?.blobEncrypted).toBe("blob-v2");
  });

  test("findByAccountId returns null when no cookie was ever saved", async () => {
    const { cookies } = testDb();
    expect(await cookies.findByAccountId(999)).toBeNull();
  });
});

describe("account_jobs repository", () => {
  test("enqueue then claim marks it processing and returns it", async () => {
    const { db, accounts, accountJobs } = testDb();
    const serviceId = seedService(db);
    const accountId = seedAccount(db, serviceId);

    const jobId = await accountJobs.enqueue(accountId);
    const claimed = await accountJobs.claim();
    expect(claimed?.id).toBe(jobId);
    expect(claimed?.status).toBe(AccountJobStatus.Processing);
  });

  test("claim returns null when nothing pending", async () => {
    const { accountJobs } = testDb();
    expect(await accountJobs.claim()).toBeNull();
  });

  test("a job with a future retry_after is not claimable yet", async () => {
    const { db, accounts, accountJobs } = testDb();
    const serviceId = seedService(db);
    const accountId = seedAccount(db, serviceId);
    const jobId = await accountJobs.enqueue(accountId);
    const future = Math.floor(Date.now() / 1000) + 3600;
    await accountJobs.updateStatus(jobId, AccountJobStatus.Pending, { retryAfter: future });

    expect(await accountJobs.claim()).toBeNull();
  });
});
