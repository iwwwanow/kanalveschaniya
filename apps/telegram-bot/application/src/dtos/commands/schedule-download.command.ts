import type { ResourceSourceUrl } from '@apps/telegram-bot-domain';
import type { TelegramChatId } from '@apps/telegram-bot-domain';
import type { TelegramMessageId } from '@apps/telegram-bot-domain';

export class ScheduleDownloadCommand {
  constructor(
    // TODO valueobject
    public readonly resourceUrl: ResourceSourceUrl,
    // TODO valueobject
    public readonly chatId: TelegramChatId,
    // TODO valueobject
    public readonly messageId: TelegramMessageId,
  ) {}
}
