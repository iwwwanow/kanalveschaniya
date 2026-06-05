import * as schema from './schema';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 🔑 КРИТИЧЕСКИ ВАЖНО: используем абсолютный путь без "./"
const dbPath = join(__dirname, '..', '..', 'data', 'db.sqlite');
console.log('Using DB file:', dbPath);

mkdirSync(join(__dirname, '..', '..', 'data'), { recursive: true });

// Убедимся, что путь существует и не содержит спецсимволов
const sqlite = new Database(dbPath, {
  // Дополнительная опция для force-open (если нужно)
  // verbose: console.log,
});

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
