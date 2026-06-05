import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync } from "fs";

const dataDir = process.env.DATA_DIR ?? join(import.meta.dir, "../../data");
mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, "bot.db");

export const db = new Database(dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
