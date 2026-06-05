import chalk from "chalk";

type Level = "info" | "warn" | "error" | "debug";

const LEVEL_TAG: Record<Level, string> = {
  info:  chalk.bgGreen.black("  INFO  "),
  warn:  chalk.bgYellow.black("  WARN  "),
  error: chalk.bgRed.white("  ERROR "),
  debug: chalk.bgGray.white("  DEBUG "),
};

const WORKER_COLORS = [
  chalk.cyan,
  chalk.magenta,
  chalk.yellow,
  chalk.blue,
  chalk.green,
];

function workerTag(id: number): string {
  const color = WORKER_COLORS[(id - 1) % WORKER_COLORS.length]!;
  return color.bold(`[worker #${id}]`);
}

function ts(): string {
  return chalk.dim(new Date().toISOString().replace("T", " ").slice(0, 19));
}

function log(level: Level, tag: string, ...args: unknown[]) {
  const line = [ts(), LEVEL_TAG[level], tag, ...args.map(String)].join(" ");
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

const systemTag = chalk.white.bold("[system]");
const botTag = chalk.white.bold("[bot]");

export const logger = {
  info:  (...args: unknown[]) => log("info",  systemTag, ...args),
  warn:  (...args: unknown[]) => log("warn",  systemTag, ...args),
  error: (...args: unknown[]) => log("error", systemTag, ...args),
  debug: (...args: unknown[]) => log("debug", systemTag, ...args),

  bot: {
    info:  (...args: unknown[]) => log("info",  botTag, ...args),
    warn:  (...args: unknown[]) => log("warn",  botTag, ...args),
    error: (...args: unknown[]) => log("error", botTag, ...args),
  },

  worker(id: number) {
    const tag = workerTag(id);
    return {
      info:  (...args: unknown[]) => log("info",  tag, ...args),
      warn:  (...args: unknown[]) => log("warn",  tag, ...args),
      error: (...args: unknown[]) => log("error", tag, ...args),
      debug: (...args: unknown[]) => log("debug", tag, ...args),
    };
  },
};
