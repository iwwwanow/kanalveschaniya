// users lives in data/telegram.db — a telegram concept (user_id, username), not a domain
// entity, so no domain port; used only by presentation handlers.
export interface TelegramUsersRepository {
  upsert(userId: number, username: string | null): Promise<void>;
}
