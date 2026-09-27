// resource_id → где лежит уже закэшированный файл в канале. Backing store для ResourceCachePort.
export interface TelegramResourceRef {
  resourceId: string;
  channelMessageId: number;
}

export interface TelegramResourceRefsRepository {
  save(resourceId: string, channelMessageId: number): Promise<void>;
  get(resourceId: string): Promise<TelegramResourceRef | null>;
}
