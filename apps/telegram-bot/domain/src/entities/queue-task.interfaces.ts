import type { QueueTaskId } from '../value-objects';
import type { QueueTaskStatus } from '../value-objects';
import type { QueueTaskPriority } from '../value-objects';
import type { ResourceSourceUrl } from '../value-objects';
import type { TelegramChatId } from '../value-objects';
import type { TelegramMessageId } from '../value-objects';
import type { QueueTaskErrorMessage } from '../value-objects';

export interface QueueTaskProps {
  taskId: QueueTaskId;
  sourceUrl: ResourceSourceUrl;
  priority: QueueTaskPriority;
  status: QueueTaskStatus;
  errorMessage: QueueTaskErrorMessage;
  // TODO telegram specific fields; mv it to special entity
  chatId: TelegramChatId;
  messageId: TelegramMessageId;
  createdAt?: Date;
  updatedAt: Date;
}
