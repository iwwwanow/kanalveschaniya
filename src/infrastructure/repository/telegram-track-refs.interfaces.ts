// track_id → где лежит уже закэшированный файл в канале. Backing store для TrackCachePort.
export interface TelegramTrackRef {
  trackId: string;
  channelMessageId: number;
}

export interface TelegramTrackRefsRepository {
  save(trackId: string, channelMessageId: number): Promise<void>;
  get(trackId: string): Promise<TelegramTrackRef | null>;
}
