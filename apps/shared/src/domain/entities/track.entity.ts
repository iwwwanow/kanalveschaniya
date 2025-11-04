export interface Track {
  id: string;
  url: string;
  title: string;
  artist: string;
  duration: number;
  filePath: string;
  downloadedAt: Date;
  status: 'pending' | 'downloaded' | 'failed';
  userId: string;
  chatId: string;
}
