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

  // TODO locales
  // TODO interfaces
  private async sendResponse(ctx, result): Promise<void> {
    switch (result.status) {
      case 'success':
        await ctx.reply(
          `✅ Добавлено! Позиция в очереди: ${result.dto.position}`,
        );
        break;
      case 'already_queued':
        await ctx.reply(`⏳ Уже в очереди! Позиция: ${result.dto.position}`);
        break;
      case 'already_downloaded':
        // TODO: отправить файл пользователю
        await ctx.reply(`📁 Уже скачано!`);
        break;
      case 'validation_error':
        await ctx.reply(`❌ Ошибка: ${result.message}`);
        break;
      default:
        await ctx.reply('🤔 Что-то пошло не так');
    }
  }

  start(): void {
    this.bot.launch();
  }
}
