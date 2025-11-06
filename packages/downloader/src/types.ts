export interface DownloadResult {
  title: string;
  artist: string;
  duration: number;
  filePath: string;
}

export interface TrackDownloader {
  download(url: string): Promise<DownloadResult>;
}
