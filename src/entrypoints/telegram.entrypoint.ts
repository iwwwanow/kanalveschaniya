import { Telegraf } from 'telegraf';

export class TelegramEntrypoint {
  private bot: Telegraf;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env');
    }
    this.bot = new Telegraf(token);
  }

  start() {
    this.bot.launch();
  }
}
