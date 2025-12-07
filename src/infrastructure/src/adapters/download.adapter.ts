import type { DownloadAdapter } from '@apps/telegram-bot-application';
import type { DownloadResult } from '@apps/telegram-bot-application';
import { ResourceSourceUrl } from '@apps/telegram-bot-domain';

export class DownloadAdapterImpl implements DownloadAdapter {
  constructor(private readonly dockerServiceUrl: string) {}

  async download(resourceUrl: ResourceSourceUrl): Promise<DownloadResult> {
    // TODO fetch
  }
}
