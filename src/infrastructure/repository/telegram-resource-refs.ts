import type { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { telegramResourceRefsTable } from "../db/schema/telegram";
import type { TelegramResourceRef, TelegramResourceRefsRepository } from "./telegram-resource-refs.interfaces";

export function createTelegramResourceRefsRepository(db: Database): TelegramResourceRefsRepository {
  const orm = drizzle(db);

  return {
    async save(resourceId, channelMessageId) {
      orm
        .insert(telegramResourceRefsTable)
        .values({ resourceId, channelMessageId })
        .onConflictDoUpdate({ target: telegramResourceRefsTable.resourceId, set: { channelMessageId } })
        .run();
    },

    async get(resourceId): Promise<TelegramResourceRef | null> {
      const row = orm
        .select()
        .from(telegramResourceRefsTable)
        .where(eq(telegramResourceRefsTable.resourceId, resourceId))
        .get();
      return row ? { resourceId: row.resourceId, channelMessageId: row.channelMessageId } : null;
    },
  };
}
