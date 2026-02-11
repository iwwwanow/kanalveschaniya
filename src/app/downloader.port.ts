import type { DownloaderResult } from './downloader.interfaces';

export interface DownloaderPort {
  download(url: string): Promise<DownloaderResult>;
}
