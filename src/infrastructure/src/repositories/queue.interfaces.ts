import type { Database } from '../db';
import type { queueTasks } from '../db';

// import type { resources } from '../db';

// TODO fix namings
export interface QueueRepositoryProps {
  db: Database;
  queueTasks: typeof queueTasks;
  // resources: typeof resources;
}
