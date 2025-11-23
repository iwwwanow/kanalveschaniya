import { Entity } from './base.entity';
import type { QueueTaskErrorMessage } from '../value-objects';

import { QueueTaskId } from '../value-objects';
import { QueueTaskStatus } from '../value-objects';
import { TaskStatusType } from '../value-objects';
import { QueueTaskPriority } from '../value-objects';
import type { ResourceSourceUrl } from '../value-objects';

import type { TelegramChatId } from '../value-objects';
import type { TelegramMessageId } from '../value-objects';

export class QueueTask extends Entity<QueueTaskId> {
  constructor(
    public taskId: QueueTaskId,
    public readonly sourceUrl: ResourceSourceUrl,
    public priority: QueueTaskPriority,
    public status: QueueTaskStatus,
    public errorMessage: QueueTaskErrorMessage,
    // TODO telegram specific fields; mv it to special entity
    public readonly chatId: TelegramChatId,
    public readonly messageId: TelegramMessageId,
    public readonly createdAt: Date = new Date(),
    public updatedAt: Date,
  ) {
    super(taskId);
  }

  canStart(): boolean {
    return this.status.getValue() === TaskStatusType.Pending;
  }

  start(): void {
    if (!this.canStart()) {
      throw new Error('Task cannot be started');
    }
    this.status.setValue(TaskStatusType.Processing);
    this.updatedAt = new Date();
  }

  complete(): void {
    this.status.setValue(TaskStatusType.Downloaded);
    this.priority.setValue(0);
    this.updatedAt = new Date();
  }

  fail(errorMessage: string): void {
    this.errorMessage.setValue(errorMessage);
    this.updatedAt = new Date();
  }

  static create(
    sourceUrl: ResourceSourceUrl,
    chatId: TelegramChatId,
    messageId: TelegramMessageId,
    priority: number = 0,
  ): QueueTask {
    return new QueueTask(
      QueueTaskId.generate(),
      sourceUrl,
      new QueueTaskPriority(priority),
      new QueueTaskStatus(TaskStatusType.Pending),
      chatId,
      messageId,
      new Date(),
      new Date(),
    );
  }
}
