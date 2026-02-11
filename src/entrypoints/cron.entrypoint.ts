import type { ProcessDownloadUseCase } from '../app';
import cron from 'node-cron';

export class CronEntrypoint {
  constructor(private processDownloadUseCase: ProcessDownloadUseCase) {}

  start() {
    const cronJob = cron.schedule('*/5 * * * *', async () => {
      console.log('[Cron] Triggering queue processing...');
      await this.processDownloadUseCase.execute(10);
    });
    cronJob.start();
  }
}
