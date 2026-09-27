import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { and, asc, eq } from "drizzle-orm";
import { AccountStatus, type Account, type AccountRepository } from "../../domain/account";
import { accountsTable } from "../db/schema/session";

type AccountRow = typeof accountsTable.$inferSelect;

function toAccount(row: AccountRow): Account {
  return { id: row.id, serviceId: row.serviceId, status: row.status, proxyId: row.proxyId, vendorRef: row.vendorRef };
}

export function createAccountsRepository(db: Database): AccountRepository {
  const orm = drizzle(db);

  return {
    async findActiveForService(serviceId) {
      const row = orm
        .select()
        .from(accountsTable)
        .where(and(eq(accountsTable.serviceId, serviceId), eq(accountsTable.status, AccountStatus.Active)))
        .orderBy(asc(accountsTable.id))
        .limit(1)
        .get();
      return row ? toAccount(row) : null;
    },

    async findById(id) {
      const row = orm.select().from(accountsTable).where(eq(accountsTable.id, id)).get();
      return row ? toAccount(row) : null;
    },

    // Select-then-conditionally-update rather than a single UPDATE ... WHERE serviceId=X AND
    // status=active: SQLite has no ORDER BY/LIMIT on UPDATE, so that would flip every active
    // account of the service at once if more than one exists (rotation is future work — for now
    // this picks the lowest id deterministically). The second, id-scoped update is still the
    // atomic dedup: it only succeeds if the row is still `active` at that instant.
    async tryStartRefresh(serviceId) {
      const candidate = orm
        .select()
        .from(accountsTable)
        .where(and(eq(accountsTable.serviceId, serviceId), eq(accountsTable.status, AccountStatus.Active)))
        .orderBy(asc(accountsTable.id))
        .limit(1)
        .get();
      if (!candidate) return null;

      const row = orm
        .update(accountsTable)
        .set({ status: AccountStatus.Refreshing })
        .where(and(eq(accountsTable.id, candidate.id), eq(accountsTable.status, AccountStatus.Active)))
        .returning()
        .get();
      return row ? toAccount(row) : null;
    },

    async markActive(id) {
      orm.update(accountsTable).set({ status: AccountStatus.Active }).where(eq(accountsTable.id, id)).run();
    },

    async markBanned(id) {
      orm.update(accountsTable).set({ status: AccountStatus.Banned }).where(eq(accountsTable.id, id)).run();
    },
  };
}
