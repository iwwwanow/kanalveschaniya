import { QueueTaskErrorMessage } from '../value-objects';
import { QueueTaskId } from '../value-objects';
import { QueueTaskStatus } from '../value-objects';
import { TaskStatusType } from '../value-objects';
import { QueueTaskPriority } from '../value-objects';
import type { ResourceSourceUrl } from '../value-objects';
import type { TelegramChatId } from '../value-objects';
import type { TelegramMessageId } from '../value-objects';
import { Entity } from './base.entity';
import type { QueueTaskProps } from './queue-task.interfaces';

export class QueueTask extends Entity<QueueTaskId> {
  public taskId: QueueTaskId;
  public readonly sourceUrl: ResourceSourceUrl;
  public priority: QueueTaskPriority;
  public status: QueueTaskStatus;
  public errorMessage: QueueTaskErrorMessage;
  public readonly chatId: TelegramChatId;
  public readonly messageId: TelegramMessageId;
  public readonly createdAt: Date;
  public updatedAt: Date;

  constructor({
    taskId,
    sourceUrl,
    priority,
    status,
    errorMessage,
    chatId,
    messageId,
    createdAt,
    updatedAt,
  }: QueueTaskProps) {
    super(taskId);

    this.taskId = taskId;
    this.sourceUrl = sourceUrl;
    this.priority = priority;
    this.status = status;
    this.errorMessage = errorMessage;
    this.chatId = chatId;
    this.messageId = messageId;
    this.createdAt = createdAt ?? new Date();
    this.updatedAt = updatedAt;
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
    props: Omit<
      QueueTaskProps,
      'taskId' | 'createdAt' | 'updatedAt' | 'status' | 'errorMessage'
    >,
  ): QueueTask {
    return new QueueTask({
      ...props,
      taskId: QueueTaskId.generate(),
      status: new QueueTaskStatus(TaskStatusType.Pending),
      errorMessage: new QueueTaskErrorMessage(''),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
