import type { queueTasks } from '../db';
import { schema } from '../db';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

// import type { resources } from '../db';

// TODO fix namings
export interface QueueRepositoryProps {
  db: BaseSQLiteDatabase<any, any, typeof schema>;
  queueTasks: typeof queueTasks;
  // resources: typeof resources;
}
