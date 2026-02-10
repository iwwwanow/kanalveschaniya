import * as schema from './schema';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'fs';

mkdirSync('./data', { recursive: true });

const sqlite = new Database('./data/db.sqlite');
export const db = drizzle(sqlite, { schema });

export type DB = typeof db;
