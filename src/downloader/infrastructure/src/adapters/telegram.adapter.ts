import { ruLocales } from '../locales';
import { ScheduleDownloadStatus } from '@apps/telegram-bot-application';
import { ScheduleDownloadUseCase } from '@apps/telegram-bot-application';
import type { ScheduleDownloadResult } from '@apps/telegram-bot-application';
import { ScheduleDownloadCommand } from '@apps/telegram-bot-application';
import { ResourceSourceUrl } from '@apps/telegram-bot-domain';
import { TelegramChatId } from '@apps/telegram-bot-domain';
import { TelegramMessageId } from '@apps/telegram-bot-domain';
import { Telegraf } from 'telegraf';
import { Context } from 'telegraf';

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

      if (!url) {
        return await ctx.reply(ruLocales['telegram.empty-url-error']);
      }

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

  private async sendResponse(
    ctx: Context,
    result: ScheduleDownloadResult,
  ): Promise<void> {
    switch (result.status) {
      case ScheduleDownloadStatus.Success:
        await ctx.reply(
          `${ruLocales['telegram.success']} ${result.dto.position}`,
        );
        break;
      // FIX: kebab-case
      case ScheduleDownloadStatus.AlreadyQueued:
        await ctx.reply(
          `${ruLocales['telegram.already-queued']} ${result.dto.position}`,
        );
        break;
      case ScheduleDownloadStatus.AlreadyDownloaded:
        // TODO: отправить файл пользователю
        await ctx.reply(ruLocales['telegram.already-downloaded']);
        break;
      case ScheduleDownloadStatus.ValidationError:
        await ctx.reply(ruLocales['telegram.validation-error']);
        break;
      // TODO: system error
      default:
        await ctx.reply(ruLocales['telegram.default']);
    }
  }

  start(): void {
    this.bot.launch();
  }
}
