import chalk from "chalk";
import { createTaggedLog, logger as systemLog, workerLog } from "shared-logger";

// Generic tag/level machinery lives in shared-logger (shared with session-service, single
// process — one coherent log stream). `.bot` is core/telegram-specific, added here.
const botTag = chalk.white.bold("[bot]");

export const logger = {
  ...systemLog,
  bot: createTaggedLog(botTag),
  worker: workerLog,
};
