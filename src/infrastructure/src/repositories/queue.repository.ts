import type { QueueRepository } from '@domain';
import { QueueTask } from '@domain';
import { QueueTaskId } from '@domain';
import { ResourceSourceUrl } from '@domain';
import { QueueTaskStatus } from '@domain';

export class QueueRepositoryImpl implements QueueRepository {
  async add(task: QueueTask): Promise<void> {
    // TODO
  }

  async remove(taskId: QueueTaskId): Promise<void> {
    // TODO
  }

  async findBySourceUrl(
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
