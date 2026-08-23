import { Telegraf } from "telegraf";
import { config } from "../config";
import { registerHandlers } from "./handlers";

export function createBot() {
  const bot = new Telegraf(config.botToken);
  registerHandlers(bot, config.channelId);
  return bot;
}
