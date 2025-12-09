import type { Database } from '../db';
import type { QueueRepositoryProps } from './queue.interfaces';
import type { QueueRepository } from '@domain';
import { QueueTask } from '@domain';
import { QueueTaskId } from '@domain';
import { ResourceSourceUrl } from '@domain';
import { QueueTaskStatus } from '@domain';
import { TaskStatusType } from '@domain';

export class QueueRepositoryImpl implements QueueRepository {
  db: QueueRepositoryProps['db'];
  queueTasks: QueueRepositoryProps['queueTasks'];

  constructor({ db, queueTasks }: QueueRepositoryProps) {
    this.db = db;
    this.queueTasks = queueTasks;
  }

  async add(task: QueueTask): Promise<void> {
    await this.db
      .insert(this.queueTasks)
      .values({
        id: task.taskId,
        url: task.sourceUrl,
        status: TaskStatusType.Pending,
      });
  }

  async remove(taskId: QueueTaskId): Promise<void> {
    // TODO
  }

  async findFirstBySourceUrl(
    taskUrl: ResourceSourceUrl,
  ): Promise<Array<QueueTask> | null> {}

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
