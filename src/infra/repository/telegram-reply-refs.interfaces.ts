// Единственный тип адреса для ответа юзеру — используется presentation-хендлерами и
// реализациями NotifierPort/TrackCachePort. Живёт в data/telegram.db.
//
// messageId: number | null — amended from the docs/specs/types.md draft (which had it as
// plain `number`) per the noble-canyon plan: legacy-migrated queue rows and playlist
// fan-out entries have a chat to reply in but no specific originating message.
export interface TelegramReplyRef {
  jobId: number;
  chatId: number;
  messageId: number | null;
}

export interface TelegramReplyRefsRepository {
  save(jobId: number, chatId: number, messageId: number | null): Promise<void>;
  get(jobId: number): Promise<TelegramReplyRef | null>;
}
