import { QueueTask } from '../entities';
import type { ResourceSourceUrl } from '../value-objects';
import type { QueueTaskId } from '../value-objects';
import type { QueueTaskStatus } from '../value-objects';

export interface QueueRepository {
  add(task: QueueTask): Promise<void>;
  remove(taskId: QueueTaskId): Promise<void>;
  findFirstBySourceUrl(taskUrl: ResourceSourceUrl): Promise<QueueTask | null>;
  findNextPending(): Promise<QueueTask | null>;
  updateStatus(taskId: QueueTaskId, status: QueueTaskStatus): Promise<void>;
  getTaskPosition(taskId: QueueTaskId): Promise<number>;
}
