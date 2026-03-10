import type { ProcessDownloadUseCase } from '../app';
import cron from 'node-cron';

export class CronEntrypoint {
  constructor(private processDownloadUseCase: ProcessDownloadUseCase) {}

  start() {
    // TODO: const/config
    const cronJob = cron.schedule('* * * * * *', async () => {
      console.log('[Cron] Triggering queue processing...');
      await this.processDownloadUseCase.execute(10);
    });
    cronJob.start();
  }
}
