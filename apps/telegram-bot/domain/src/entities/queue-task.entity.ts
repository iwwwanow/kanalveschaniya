import { Entity } from "./base.entity";

import type { QueueTaskId } from "../value-objects";
import type { QueueTaskStatus } from "../value-objects";
import { TaskStatus } from "../value-objects";
import type { QueueTaskPriority } from "../value-objects";
import type { ResourceSourceUrl } from "../value-objects";

import type { TelegramChatId } from "../value-objects";
import type { TelegramMessageId } from "../value-objects";

export class QueueTask extends Entity<QueueTaskId> {
  constructor(
    taskId: QueueTaskId,
    public readonly sourceUrl: ResourceSourceUrl,
    public priority: QueueTaskPriority,
    public status: QueueTaskStatus,
    // TODO telegram specific fields; mv it to special entity
    public readonly chatId: TelegramChatId,
    public readonly messageId: TelegramMessageId,
    public readonly createdAt: Date = new Date(),
    public updatedAt: Date
  ) {
    super(taskId)
  }

  canStart(): boolean {
    return this.status.getValue() === TaskStatus.Pending
  }

  start(): void {
    if (!this.canStart()) {
      throw new Error('Task cannot be started');
    }
    this.status.setValue(TaskStatus.Processing);
    this.updatedAt = new Date();
  }
}
