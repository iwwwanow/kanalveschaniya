import type { QueueRepositoryProps } from './queue.interfaces';
import type { QueueRepository } from '@domain';
import { QueueTask } from '@domain';
import { QueueTaskId } from '@domain';
import { ResourceSourceUrl } from '@domain';
import { QueueTaskStatus } from '@domain';
import { eq } from 'drizzle-orm';

export class QueueRepositoryImpl implements QueueRepository {
  db: QueueRepositoryProps['db'];
  queueTasks: QueueRepositoryProps['queueTasks'];

  // TODO naming
  constructor({ db, queueTasks }: QueueRepositoryProps) {
    this.db = db;
    this.queueTasks = queueTasks;
  }

  async add(task: QueueTask): Promise<void> {
    await this.db.insert(this.queueTasks).values({
      id: task.taskId.toString(),
      url: task.sourceUrl.toString(),
      status: task.status.getValue(),
      priority: task.priority.getValue(),
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    });
  }

  async remove(taskId: QueueTaskId): Promise<void> {
    await this.db
      .delete(this.queueTasks)
      .where(eq(this.queueTasks.id, taskId.toString()));
  }

  async findFirstBySourceUrl(
    taskUrl: ResourceSourceUrl,
  ): Promise<Array<QueueTask> | null> {
    // const queueTask = await this.db.select({url: taskUrl.toString()}).from(this.queueTasks)
    const results = await this.db
      .select()
      .from(this.queueTasks)
      .where(eq(this.queueTasks.url, taskUrl.toString()))
      .limit(1);

    // TODO map to domain instance

    return results[0];
  }

  async findNextPending(): Promise<QueueTask | null> {
    // TODO
  }

  async updateStatus(
    taskId: QueueTaskId,
    status: QueueTaskStatus,
  ): Promise<void> {
    // TODO
  }

  async getTaskPosition(taskId: QueueTaskId): Promise<number> {
    // TODO
  }
}
