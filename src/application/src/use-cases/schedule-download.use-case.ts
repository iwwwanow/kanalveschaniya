import type { ScheduleDownloadCommand } from '../dtos';
import type { ScheduleDownloadResult } from '../dtos';
import type { ScheduleDownloadSuccessResult } from '../dtos';
import { ScheduleDownloadStatus } from '../dtos';
import { QueueTask } from '@apps/telegram-bot-domain';
import type {
  QueueRepository,
  TelegramChatId,
  TelegramMessageId,
} from '@apps/telegram-bot-domain';
import type { ResourceRepository } from '@apps/telegram-bot-domain';
import type { ResourceSourceUrl } from '@apps/telegram-bot-domain';

export class ScheduleDownloadUseCase {
  constructor(
    private readonly queueRepository: QueueRepository,
    private readonly resourceRepository: ResourceRepository,
    private readonly logger: { info: Function; error: Function } = console,
  ) {}

  async execute(
    command: ScheduleDownloadCommand,
  ): Promise<ScheduleDownloadResult> {
    try {
      const { resourceUrl, chatId, messageId } = command;

      const existingCheck = await this.checkExistingResource(resourceUrl);
      if (existingCheck) return existingCheck;

      const queuedCheck = await this.checkQueuedTask(resourceUrl);
      if (queuedCheck) return queuedCheck;

      const createdTask = await this.createQueueTask(
        resourceUrl,
        chatId,
        messageId,
      );

      this.logger.info(
        `Scheduling download for ${command.resourceUrl}, ${createdTask.dto?.taskId as string}`,
      );
      return createdTask;
    } catch (error: unknown) {
      this.logger.error(`Error download for ${command.resourceUrl}`, error);

      if (error instanceof Error) {
        return {
          status: ScheduleDownloadStatus.SystemError,
          message: error.message,
        };
      }
      throw error;
    }
  }

  private async checkExistingResource(
    resourceUrl: ResourceSourceUrl,
  ): Promise<ScheduleDownloadResult | null> {
    const existingResource =
      await this.resourceRepository.findFirstBySourceUrl(resourceUrl);
    if (existingResource) {
      return {
        status: ScheduleDownloadStatus.AlreadyDownloaded,
        dto: { resourceId: existingResource.resourceId.toString() },
      };
    }
    return null;
  }

  private async checkQueuedTask(
    resourceUrl: ResourceSourceUrl,
  ): Promise<ScheduleDownloadResult | null> {
    const queueTask =
      await this.queueRepository.findFirstBySourceUrl(resourceUrl);
    if (queueTask) {
      const taskPosition = await this.queueRepository.getTaskPosition(
        queueTask.taskId,
      );
      return {
        status: ScheduleDownloadStatus.AlreadyQueued,
        dto: { taskId: queueTask.taskId.toString(), position: taskPosition },
      };
    }
    return null;
  }

  private async createQueueTask(
    resourceUrl: ResourceSourceUrl,
    chatId: TelegramChatId,
    messageId: TelegramMessageId,
  ): Promise<ScheduleDownloadSuccessResult> {
    const newQueueTask = QueueTask.create({
      sourceUrl: resourceUrl,
      chatId,
      messageId,
    });
    await this.queueRepository.add(newQueueTask);
    const taskPosition = await this.queueRepository.getTaskPosition(
      newQueueTask.taskId,
    );

    return {
      status: ScheduleDownloadStatus.Success,
      dto: {
        taskId: newQueueTask.taskId.toString(),
        chatId: newQueueTask.chatId.toString(),
        messageId: newQueueTask.messageId.toString(),
        position: taskPosition,
      },
    };
  }
}
