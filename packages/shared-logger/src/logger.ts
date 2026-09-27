import chalk from "chalk";
import { describeError, redact } from "shared-secrets";

// Shared between core and session-service (single process, see docs/specs/session-app.specs.md)
// so both apps' log lines look the same in the one stream a Pi deploy actually tails. core adds
// its own `.bot` tag on top (see apps/core/src/logger.ts) — the generic tag/level machinery lives
// here since neither app owns it more than the other.

export type Level = "info" | "warn" | "error" | "debug";

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

// Every argument passes through redact(): a thrown value may carry a secret (core's bot token,
// session-service's decrypted cookie), and nothing logged is worth leaking it — see
// shared-secrets/redact.ts.
function format(arg: unknown): string {
  return arg instanceof Error ? describeError(arg) : redact(String(arg));
}

export function log(level: Level, tag: string, ...args: unknown[]): void {
  const line = [ts(), LEVEL_TAG[level], tag, ...args.map(format)].join(" ");
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export interface TaggedLog {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export function createTaggedLog(tag: string): TaggedLog {
  return {
    info:  (...args: unknown[]) => log("info",  tag, ...args),
    warn:  (...args: unknown[]) => log("warn",  tag, ...args),
    error: (...args: unknown[]) => log("error", tag, ...args),
    debug: (...args: unknown[]) => log("debug", tag, ...args),
  };
}

const systemTag = chalk.white.bold("[system]");

// Default system-tagged logger (core's top-level logger.info/warn/error/debug) — a worker or any
// other tagged stream is built with createTaggedLog/workerLog instead.
export const logger: TaggedLog = createTaggedLog(systemTag);

export function workerLog(id: number): TaggedLog {
  return createTaggedLog(workerTag(id));
}
