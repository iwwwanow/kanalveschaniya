import { initSchema } from "./db/schema";
import { createBot } from "./bot";
import { startWorker } from "./worker";

initSchema();

const bot = createBot();
startWorker(bot);

bot.launch();
console.log("[bot] started");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
