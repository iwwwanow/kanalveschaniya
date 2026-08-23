import { Telegraf } from "telegraf";
import { SocksProxyAgent } from "socks-proxy-agent";
import { config } from "../config";
import { registerHandlers } from "./handlers";

export function createBot() {
  const agent = config.proxy ? new SocksProxyAgent(config.proxy, { keepAlive: false }) : undefined;
  const bot = new Telegraf(config.botToken, agent ? { telegram: { agent } } : undefined);
  registerHandlers(bot, config.channelId);
  return bot;
}
