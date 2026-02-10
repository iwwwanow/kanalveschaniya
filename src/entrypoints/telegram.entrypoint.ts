import { ScheduleDownloadUseCase } from '../app';
import { URL_REGEX } from './telegram.constants';
import * as telegramLocales from './telegram.locales.json';
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

    const urls = [...text.matchAll(URL_REGEX)].map((match) => match[0]);

    if (urls.length === 0) {
      // TODO: locales
      await ctx.reply(telegramLocales['not-found']);
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
      await ctx.reply(telegramLocales['not-any-valid']);
      return;
    }

    for (const url of validUrls) {
      try {
        await this.scheduleDownloadUseCase.execute(url);
        await ctx.reply(`${telegramLocales['found-and-added']}:\n${url}`);
      } catch (error) {
        console.error(`Failed to schedule ${url}:`, error);
        await ctx.reply(`${telegramLocales['adding-error']}: ${url}`);
      }
    }
  }
}
