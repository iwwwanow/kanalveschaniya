import { db } from '../src/storage/client';
import 'dotenv/config';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations complete!');
