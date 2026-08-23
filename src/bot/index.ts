import { Telegraf } from "telegraf";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../config";
import { registerHandlers } from "./handlers";

export function createBot() {
  const agent = config.proxy ? new HttpsProxyAgent(config.proxy, { keepAlive: false }) : undefined;
  const bot = new Telegraf(config.botToken, agent ? { telegram: { agent } } : undefined);
  registerHandlers(bot, config.channelId);
  return bot;
}
