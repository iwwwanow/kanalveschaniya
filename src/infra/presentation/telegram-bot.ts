import { Telegraf } from "telegraf";
import { config } from "../../config";
import { registerHandlers, type TelegramHandlersDeps } from "./telegram-handlers";

export function createBot(deps: Omit<TelegramHandlersDeps, "bot">): Telegraf {
  const bot = new Telegraf(config.botToken);
  registerHandlers({ bot, ...deps });
  return bot;
}
