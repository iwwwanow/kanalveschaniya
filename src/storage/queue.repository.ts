import type { DB } from './client';
import { queue, resources } from './schema';
import { eq, isNull } from 'drizzle-orm';

export class QueueRepository {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  async add(resourceId: number): Promise<void> {
    await this.db.insert(queue).values({ resourceId });
  }

  async getPending(
    limit: number,
    // TODO: use interface
  ): Promise<Array<{ id: number; resourceId: number; url: string }>> {
    const tasks = await this.db
      .select({
        id: queue.id,
        resourceId: queue.resourceId,
        url: resources.url,
      })
      .from(queue)
      .innerJoin(resources, eq(queue.resourceId, resources.id))
      .where(isNull(queue.processedAt))
      .limit(limit);

    return tasks;
  }

  async markAsProcessed(id: number): Promise<void> {
    await this.db
      .update(queue)
      .set({ processedAt: new Date() })
      .where(eq(queue.id, id));
  }
}
