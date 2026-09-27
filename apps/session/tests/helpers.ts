import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openSessionDb } from "../src/infrastructure/db/session-db";
import { createServicesRepository } from "../src/infrastructure/repository/services-repository";
import { createAccountsRepository } from "../src/infrastructure/repository/accounts-repository";
import { createProxiesRepository } from "../src/infrastructure/repository/proxies-repository";
import { createCookiesRepository } from "../src/infrastructure/repository/cookies-repository";
import { createAccountJobsRepository } from "../src/infrastructure/repository/account-jobs-repository";

export function tmpDir(prefix = "kv-session-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Real sqlite + real repositories — same style as apps/core/tests/helpers.ts's rig().
export function testDb() {
  const db = openSessionDb(tmpDir());
  return {
    db,
    services: createServicesRepository(db),
    accounts: createAccountsRepository(db),
    proxies: createProxiesRepository(db),
    cookies: createCookiesRepository(db),
    accountJobs: createAccountJobsRepository(db),
  };
}

export const noopLog = { info() {}, warn() {}, error() {}, debug() {} };
