import type { DownloadResult } from '../dtos';
import { ResourceSourceUrl } from '@apps/telegram-bot-domain';

export interface DownloadAdapter {
  download(resourceUrl: ResourceSourceUrl): Promise<DownloadResult>;
}
