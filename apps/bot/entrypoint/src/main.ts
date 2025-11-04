// src/main.ts
import { Telegraf, Context } from "telegraf";
import { BotController } from "@apps/bot-presentation";
import { BotCommand } from "@apps/shared-domain";

class BotApplication {
  private bot: Telegraf;
  private botController: BotController;

  constructor() {
    this.bot = new Telegraf(process.env.BOT_TOKEN!);
    this.botController = new BotController();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Команда /start
    // TODO change commands to enum
    this.bot.command("start", async (ctx: Context) => {
      const command = BotCommand.createStart(
        ctx.from?.id.toString() || "unknown",
        ctx.chat?.id.toString() || "unknown",
      );

      const response = await this.botController.handleCommand(command);
      await ctx.reply(response.text, response.options);
    });

    // Команда /help
    this.bot.command("help", async (ctx: Context) => {
      const command = BotCommand.createHelp(
        ctx.from?.id.toString() || "unknown",
        ctx.chat?.id.toString() || "unknown",
      );

      const response = await this.botController.handleCommand(command);
      await ctx.reply(response.text, response.options);
    });

    // Обработка неизвестных команд
    this.bot.on("text", async (ctx: Context) => {
      const command = BotCommand.createHelp(
        ctx.from?.id.toString() || "unknown",
        ctx.chat?.id.toString() || "unknown",
      );

      const response = await this.botController.handleCommand(command);
      await ctx.reply(response.text, response.options);
    });
  }

  start(): void {
    this.bot.launch();
    console.log("🎵 Bot started!");
  }
}

// Запуск бота
const botApp = new BotApplication();
botApp.start();
//
// // Обработка graceful shutdown
// process.once('SIGINT', () => botApp.bot.stop('SIGINT'));
// process.once('SIGTERM', () => botApp.bot.stop('SIGTERM'));
