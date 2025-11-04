export class DownloadTrackUseCase {
  constructor(
    private trackCache: TrackCacheService,
    private trackDownloader: TrackDownloader,
    private trackRepository: TrackRepository,
    private messageBus: MessageBus,
  ) {}

  async execute(
    url: string,
    userId: string,
    chatId: string,
  ): Promise<{ track: Track; cached: boolean }> {
    // TODO user logic

    // Проверяем кэш
    const cachedTrack = await this.trackCache.getCachedTrack(url);
    if (cachedTrack) {
      await this.messageBus.publish("track.downloaded", {
        trackId: cachedTrack.id,
        cached: true,
        url,
      });
      return { track: cachedTrack, cached: true };
    }

    // Скачиваем
    const downloadResult = await this.trackDownloader.download(url);

    // Сохраняем в кэш
    const track = await this.trackCache.cacheTrack({
      url,
      title: downloadResult.title,
      artist: downloadResult.artist,
      duration: downloadResult.duration,
      filePath: downloadResult.filePath,
      status: "downloaded",
    });

    await this.messageBus.publish("track.downloaded", {
      trackId: track.id,
      cached: false,
      url,
    });

    return { track, cached: false };
  }
}
