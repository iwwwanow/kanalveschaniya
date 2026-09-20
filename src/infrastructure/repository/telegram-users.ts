import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { usersTable } from "../db/schema/telegram";
import type { TelegramUsersRepository } from "./telegram-users.interfaces";

export function createTelegramUsersRepository(db: Database): TelegramUsersRepository {
  const orm = drizzle(db);

  return {
    async upsert(userId, username) {
      orm.insert(usersTable).values({ userId, username }).onConflictDoNothing().run();
    },
  };
}
