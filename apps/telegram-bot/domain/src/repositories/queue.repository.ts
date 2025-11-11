import { QueueTask } from "../entities"

import type { ResourceSourceUrl } from "../value-objects"
import type { QueueTaskId } from "../value-objects"
import type { QueueTaskStatus } from "../value-objects"

export interface QueueRepository {
  add(task: QueueTask): Promise<void>
  remove(taskId: QueueTaskId): Promise<void>
  findBySourceUrl(taskUrl: ResourceSourceUrl): Promise<Array<QueueTask> | null>
  findNextPending(): Promise<QueueTask | null>
  updateStatus(taskId: QueueTaskId, status: QueueTaskStatus): Promise<void>
}
