import type { QueueRepository } from '../storage';
import type { ResourceRepository } from '../storage';
import type { DownloaderPort } from './downloader.port';
import { DOWNLOAD_LIMIT } from './process-download.constants';

export class ProcessDownloadUseCase {
  constructor(
    private queueRepository: QueueRepository,
    private resourceRepository: ResourceRepository,
    private downloader: DownloaderPort,
  ) {}

  async execute(limit: number = DOWNLOAD_LIMIT): Promise<void> {
    console.log(
      `[ProcessDownload] Starting processing up to ${limit} tasks...`,
    );

    const tasks = await this.queueRepository.getPending(limit);

    if (tasks.length === 0) {
      console.log('[ProcessDownload] No pending tasks found');
      return;
    }

    console.log(`[ProcessDownload] Found ${tasks.length} pending tasks`);

    for (const task of tasks) {
      try {
        console.log(
          `[ProcessDownload] Processing task ${task.id} for URL: ${task.url}`,
        );

        await this.resourceRepository.updateStatus(
          task.resourceId,
          'processing',
        );

        const result = await this.downloader.download(task.url);

        if (result.success) {
          await this.resourceRepository.updateStatus(
            task.resourceId,
            'downloaded',
          );
          console.log(`[ProcessDownload] Successfully downloaded: ${task.url}`);
        } else {
          await this.resourceRepository.updateStatus(task.resourceId, 'error');
          console.error(
            `[ProcessDownload] Download failed for ${task.url}: ${result.error}`,
          );
        }

        await this.queueRepository.markAsProcessed(task.id);
        console.log(`[ProcessDownload] Task ${task.id} marked as processed`);
      } catch (error) {
        console.error(
          `[ProcessDownload] Unexpected error processing task ${task.id}:`,
          error,
        );
        await this.resourceRepository.updateStatus(task.resourceId, 'error');

        await this.queueRepository.markAsProcessed(task.id);
      }
    }

    console.log(`[ProcessDownload] Completed processing ${tasks.length} tasks`);
  }
}
