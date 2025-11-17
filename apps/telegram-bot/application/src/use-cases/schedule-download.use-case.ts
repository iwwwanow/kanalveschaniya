import { QueueTask } from "@apps/telegram-bot-domain";
import type { QueueRepository } from "@apps/telegram-bot-domain";
import type { ResourceRepository } from "@apps/telegram-bot-domain";
import type { ScheduleDownloadCommand } from "../dtos";
import type { ScheduleDownloadResult } from "../dtos";
import { ScheduleDownloadStatus } from "../dtos";
import { DatabaseConnectionError } from "../errors";
import { FileSystemError } from "../errors";

export class ScheduleDownloadUseCase {
  constructor(
    private readonly queueRepository: QueueRepository,
    private readonly resourceRepository: ResourceRepository,
  ) { }

  async execute(command: ScheduleDownloadCommand): Promise<ScheduleDownloadResult> {
    try {
      const { resourceUrl, chatId, messageId } = command

      const existingResource = await this.resourceRepository.findBySourceUrl(resourceUrl)
      if (existingResource) {
        return {
          status: ScheduleDownloadStatus.AlreadyDownloaded,
          resource: existingResource
        }
      }

      const queueTask = await this.queueRepository.findBySourceUrl(resourceUrl)
      // TODO нужно оповещать пользователя в любом случае. даже если задача в очереди уже есть. как это сделать?
      // TODO может быть для оповещений сделать отдельную таблицу?
      if (queueTask && queueTask[0]) {
        return {
          status: ScheduleDownloadStatus.AlreadyQueued,
          task: queueTask[0]
        }
      }

      const newQueueTask = QueueTask.create(resourceUrl, chatId, messageId, 0)
      await this.queueRepository.add(newQueueTask)

      return {
        status: ScheduleDownloadStatus.Success,
        task: newQueueTask
      }
    } catch (error) {
      if (error instanceof DatabaseConnectionError) {
        // TODO process error; log it
        throw error;
      }

      if (error instanceof FileSystemError) {
        // TODO process error; log it
        throw error;
      }

      throw error;
    }
  }
}
