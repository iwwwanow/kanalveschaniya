import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { AccountJobStatus, type AccountJob, type AccountJobRepository } from "../../domain/account-job";
import { accountJobsTable } from "../db/schema/session";

type AccountJobRow = typeof accountJobsTable.$inferSelect;

function toAccountJob(row: AccountJobRow): AccountJob {
  return {
    id: row.id,
    accountId: row.accountId,
    status: row.status,
    retries: row.retries,
    retryAfter: row.retryAfter,
    error: row.error,
  };
}

export function createAccountJobsRepository(db: Database): AccountJobRepository {
  const orm = drizzle(db);

  return {
    async enqueue(accountId) {
      const row = orm.insert(accountJobsTable).values({ accountId }).returning({ id: accountJobsTable.id }).get();
      return row.id;
    },

    async claim() {
      const row = orm
        .select()
        .from(accountJobsTable)
        .where(
          and(
            eq(accountJobsTable.status, AccountJobStatus.Pending),
            or(isNull(accountJobsTable.retryAfter), lte(accountJobsTable.retryAfter, sql`unixepoch()`)),
          ),
        )
        .orderBy(asc(accountJobsTable.id))
        .limit(1)
        .get();
      if (!row) return null;
      orm.update(accountJobsTable).set({ status: AccountJobStatus.Processing }).where(eq(accountJobsTable.id, row.id)).run();
      return toAccountJob({ ...row, status: AccountJobStatus.Processing });
    },

    async updateStatus(id, status, patch) {
      const set: Partial<typeof accountJobsTable.$inferInsert> = { status };
      if (patch?.retries !== undefined) set.retries = patch.retries;
      if (patch?.retryAfter !== undefined) set.retryAfter = patch.retryAfter;
      if (patch?.error !== undefined) set.error = patch.error;
      orm.update(accountJobsTable).set(set).where(eq(accountJobsTable.id, id)).run();
    },
  };
}
