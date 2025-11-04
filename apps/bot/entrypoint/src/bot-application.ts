import { BotController } from "@apps/bot-presentation";
import { BotCommand } from "@apps/shared-domain";
import { BotCommandTypes } from "@apps/shared-domain";
import { Telegraf } from "telegraf";
import { Context } from "telegraf";
import { message } from "telegraf/filters";

export class BotApplication {
  bot: Telegraf;
  private botController: BotController;

  constructor() {
    this.bot = new Telegraf(process.env.BOT_TOKEN!);
    this.botController = new BotController();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.command(BotCommandTypes.Start, async (ctx: Context) => {
      const command = BotCommand.createStart(
        ctx.from?.id.toString() || "unknown",
        ctx.chat?.id.toString() || "unknown",
      );

      const response = await this.botController.handleCommand(command);
      await ctx.reply(response.text, response.options);
    });

    this.bot.command(BotCommandTypes.Help, async (ctx: Context) => {
      const command = BotCommand.createHelp(
        ctx.from?.id.toString() || "unknown",
        ctx.chat?.id.toString() || "unknown",
      );

      const response = await this.botController.handleCommand(command);
      await ctx.reply(response.text, response.options);
    });

    this.bot.on(message("text"), async (ctx: Context) => {
      if (!ctx.message || !("text" in ctx.message)) {
        return;
      }

      const command = BotCommand.createMessage(
        ctx.from?.id.toString() || "unknown",
        ctx.chat?.id.toString() || "unknown",
        ctx.message?.text,
      );

      const response = await this.botController.handleCommand(command);
      await ctx.reply(response.text, response.options);
    });
  }

  start(): void {
    this.bot.launch();
    console.log("telegram-bot-launched");
  }
}
