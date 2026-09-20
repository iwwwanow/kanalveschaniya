import type { Database } from "bun:sqlite";
import type { TelegramUsersRepository } from "./telegram-users.interfaces";

export function createTelegramUsersRepository(db: Database): TelegramUsersRepository {
  return {
    async upsert(userId, username) {
      db.run(`INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)`, [userId, username]);
    },
  };
}
