import { Database } from "bun:sqlite";
import { join } from "path";

const dbPath = join(import.meta.dir, "../../data/bot.db");

export const db = new Database(dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
