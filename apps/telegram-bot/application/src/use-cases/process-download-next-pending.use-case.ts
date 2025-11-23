import type { QueueRepository } from "@apps/telegram-bot-domain";
import type { ResourceRepository } from "@apps/telegram-bot-domain";
import type { DownloadAdapter } from "../interfaces";

export class ProcessDownloadNextPendingUseCase {
  constructor(
    private readonly queueRepository: QueueRepository,
    private readonly resourceRepository: ResourceRepository,
    private readonly logger: { info: Function; error: Function } = console
  ) { }

  async execute(downloadAdapter: DownloadAdapter): Promise<void> {
    const task = await this.queueRepository.findNextPending();
    if (!task) return;

    try {
      task.start();
      await this.queueRepository.updateStatus(task.taskId, task.status);

      // Используем адаптер напрямую, без доменного интерфейса
      const downloadResult = await downloadAdapter.download(task.sourceUrl);

      if (!downloadResult.success) {
        throw new Error(downloadResult.error);
      }

      this.logger.info(`Download completed for ${task.sourceUrl.toString()}`);
      // TODO взаимодействие с resourceUrl
      // пока не понимаю, в каком виде будет ответ.
      // скорее всего это будет stream
      // на каком уровне записывать запись на диск

      task.complete();
      await this.queueRepository.updateStatus(task.taskId, task.status);

    } catch (error) {
      this.logger.error(`Download error for ${task.sourceUrl.toString()}`);

      if (error instanceof Error) {
        task.fail(error.message);
        await this.queueRepository.updateStatus(task.taskId, task.status);
      }

      throw error
    }
  }
}
