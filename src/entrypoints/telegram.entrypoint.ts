import { ScheduleDownloadUseCase } from '../app';
import { Context } from 'telegraf';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';

export class TelegramEntrypoint {
  private bot: Telegraf;
  private scheduleDownloadUseCase: ScheduleDownloadUseCase;

  constructor(scheduleDownloadUseCase: ScheduleDownloadUseCase) {
    this.scheduleDownloadUseCase = scheduleDownloadUseCase;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env');
    }
    this.bot = new Telegraf(token);
  }

  start() {
    this.bot.launch();
    this.bot.start((ctx) => ctx.reply('Welcome'));

    this.bot.on(message('text'), (ctx) => this.processMessage(ctx));
  }

  private async processMessage(ctx: Context) {
    if (
      !ctx.message ||
      !('text' in ctx.message) ||
      typeof ctx.message.text !== 'string'
    ) {
      return;
    }

    const text = ctx.message.text;

    // TODO: consts
    const urlRegex =
      /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi;

    const urls = [...text.matchAll(urlRegex)].map((match) => match[0]);

    if (urls.length === 0) {
      // TODO: locales
      await ctx.reply('Не нашёл ссылок в вашем сообщении.');
      return;
    }

    const validUrls = urls.filter((url) => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    });

    if (validUrls.length === 0) {
      // TODO: locales
      await ctx.reply('Ни одна из найденных ссылок не является валидной.');
      return;
    }

    for (const url of validUrls) {
      try {
        await this.scheduleDownloadUseCase.execute(url);
        // TODO: locales
        await ctx.reply(`✅ Найдено и добавлено в очередь:\n${url}`);
      } catch (error) {
        console.error(`Failed to schedule ${url}:`, error);
        // TODO: locales
        await ctx.reply(`❌ Не удалось добавить: ${url}`);
      }
    }
  }
}
