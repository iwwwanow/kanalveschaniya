import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, sql } from "drizzle-orm";
import type { CookieRepository } from "../../domain/cookie";
import { cookiesTable } from "../db/schema/session";

export function createCookiesRepository(db: Database): CookieRepository {
  const orm = drizzle(db);

  return {
    async findByAccountId(accountId) {
      const row = orm.select().from(cookiesTable).where(eq(cookiesTable.accountId, accountId)).get();
      return row ? { accountId: row.accountId, blobEncrypted: row.blobEncrypted, lastUsedAt: row.lastUsedAt } : null;
    },

    async upsert(accountId, blobEncrypted) {
      orm
        .insert(cookiesTable)
        .values({ accountId, blobEncrypted })
        .onConflictDoUpdate({
          target: cookiesTable.accountId,
          set: { blobEncrypted, createdAt: sql`(unixepoch())` },
        })
        .run();
    },

    async touchLastUsed(accountId) {
      orm.update(cookiesTable).set({ lastUsedAt: sql`(unixepoch())` }).where(eq(cookiesTable.accountId, accountId)).run();
    },
  };
}
