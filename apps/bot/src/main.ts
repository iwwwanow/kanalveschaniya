import { Telegraf } from 'telegraf';
import { Container } from '../../../shared/infrastructure/di/container';
import { BotController } from './presentation/telegram/bot.controller';

class BotApplication {
  private bot: Telegraf;
  private botController: BotController;

  constructor() {
    this.bot = new Telegraf(process.env.BOT_TOKEN!);
    this.botController = Container.getInstance().resolve('BotController');
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.on('text', (ctx) => this.botController.handleMessage(ctx));
    
    // Команды
    this.bot.command('download', (ctx) => this.botController.handleMessage(ctx));
    this.bot.command('start', (ctx) => ctx.reply('Welcome! Send me a YouTube URL'));
    this.bot.command('help', (ctx) => ctx.reply('Use /download <url> to download music'));
  }

  start(): void {
    this.bot.launch();
    console.log('Bot started');
  }
}

new BotApplication().start();
