import { ruLocales } from '../locales';
import { ScheduleDownloadUseCase } from '@apps/telegram-bot-application';
import { ScheduleDownloadCommand } from '@apps/telegram-bot-application';
import { ResourceSourceUrl } from '@apps/telegram-bot-domain';
import { TelegramChatId } from '@apps/telegram-bot-domain';
import { TelegramMessageId } from '@apps/telegram-bot-domain';
import { Telegraf } from 'telegraf';

export class TelegramAdapter {
  bot: Telegraf;

  constructor(
    private readonly scheduleDownloadUseCase: ScheduleDownloadUseCase,
    readonly botToken: string,
  ) {
    this.bot = new Telegraf(botToken);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.command('download', async (ctx) => {
      const url = ctx.message.text.split(' ')[1];

      // TODO empty string exception

      const resourceUrl = new ResourceSourceUrl(url);
      const chatId = new TelegramChatId(ctx.chat.id.toString());
      const messageId = new TelegramMessageId(
        ctx.message.message_id.toString(),
      );

      const command = new ScheduleDownloadCommand(
        resourceUrl,
        chatId,
        messageId,
      );

      const result = await this.scheduleDownloadUseCase.execute(command);

      await this.sendResponse(ctx, result);
    });
  }

  // TODO interfaces
  private async sendResponse(ctx, result): Promise<void> {
    switch (result.status) {
      case 'success':
        await ctx.reply(
          `${ruLocales['telegram.success']} ${result.dto.position}`,
        );
        break;
      // FIX: kebab-case
      case 'already_queued':
        await ctx.reply(
          `${ruLocales['telegram.already-queued']} ${result.dto.position}`,
        );
        break;
      case 'already_downloaded':
        // TODO: отправить файл пользователю
        await ctx.reply(ruLocales['telegram.already-downloaded']);
        break;
      case 'validation_error':
        await ctx.reply(ruLocales['telegram.validation-error']);
        break;
      default:
        await ctx.reply(ruLocales['telegram.default']);
    }
  }

  start(): void {
    this.bot.launch();
  }
}
