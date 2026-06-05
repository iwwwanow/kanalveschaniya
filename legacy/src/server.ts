import { CobaltAdapter } from './adapters';
import { ScheduleDownloadUseCase } from './app';
import { ProcessDownloadUseCase } from './app';
import { TelegramEntrypoint } from './entrypoints';
import { CronEntrypoint } from './entrypoints';
import { db } from './storage';
import { QueueRepository } from './storage';
import { ResourceRepository } from './storage';
import 'dotenv/config';

const main = () => {
  console.log('server startup');

  const cobaltAdapter = new CobaltAdapter();

  const queueRepository = new QueueRepository(db);
  const resourceRepository = new ResourceRepository(db);

  const scheduleDownloadUseCase = new ScheduleDownloadUseCase(
    queueRepository,
    resourceRepository,
  );
  const processDownloadUseCase = new ProcessDownloadUseCase(
    queueRepository,
    resourceRepository,
    cobaltAdapter,
  );
  const telegramEntrypoint = new TelegramEntrypoint(scheduleDownloadUseCase);
  const cronEntrypoint = new CronEntrypoint(processDownloadUseCase);

  telegramEntrypoint.start();
  cronEntrypoint.start();
};

main();
