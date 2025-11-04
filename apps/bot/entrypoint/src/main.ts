import { BotApplication } from "./bot-application";

const botApp = new BotApplication();
botApp.start();

process.once("SIGINT", () => botApp.bot.stop("SIGINT"));
process.once("SIGTERM", () => botApp.bot.stop("SIGTERM"));
