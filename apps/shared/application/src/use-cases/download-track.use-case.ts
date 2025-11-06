import type { Track } from "@apps/shared-domain";
import { SoundCloudAdapter } from '@packages/downloader';
import type { TrackDownloader } from '@packages/downloader';

// TODO interfaces/domain?
// export interface DownloadResult {
//   title: string;
//   artist: string;
//   duration: number;
//   filePath: string;
// }
//
// export interface TrackDownloader {
//   download(url: string): Promise<DownloadResult>;
// }

export interface TrackRepository {
  findByUrl(url: string): Promise<Track | null>;
  save(track: Track): Promise<void>;
  updateStatus(trackId: string, status: Track['status']): Promise<void>;
}

export class TrackCacheService {
  constructor(
    private trackRepository: TrackRepository,
    private trackDownloader: TrackDownloader = new SoundCloudAdapter()
  ) { }

  async getCachedTrack(url: string): Promise<Track | null> {
    return this.trackRepository.findByUrl(url);
  }

  async cacheTrack(trackData: Omit<Track, 'id' | 'downloadedAt'>): Promise<Track> {
    const track: Track = {
      ...trackData,
      id: crypto.randomUUID(),
      downloadedAt: new Date(),
    };

    await this.trackRepository.save(track);
    return track;
  }
}

export class DownloadTrackUseCase {
  constructor(
    private trackCache: TrackCacheService,
    private trackDownloader: TrackDownloader = new SoundCloudAdapter(),
    private trackRepository: TrackRepository,
    // private messageBus: MessageBus, // Убрали на сейчас
  ) { }

  async execute(
    url: string,
    userId: string,
    chatId: string,
  ): Promise<{ track: Track; cached: boolean }> {
    // Проверяем кэш
    const cachedTrack = await this.trackCache.getCachedTrack(url);
    if (cachedTrack) {
      // await this.messageBus.publish("track.downloaded", { // Убрали
      //   trackId: cachedTrack.id,
      //   cached: true,
      //   url,
      // });
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
      userId,    // Добавили пользователя
      chatId,    // Добавили чат
    });

    // await this.messageBus.publish("track.downloaded", { // Убрали
    //   trackId: track.id,
    //   cached: false,
    //   url,
    // });

    return { track, cached: false };
  }
}
