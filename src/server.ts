import { ScheduleDownloadUseCase } from './app';
import { TelegramEntrypoint } from './entrypoints';
import { db } from './storage';
import { QueueRepository } from './storage';
import { ResourceRepository } from './storage';
import 'dotenv/config';

const main = () => {
  console.log('server startup');

  const queueRepository = new QueueRepository(db);
  const resourceRepository = new ResourceRepository(db);

  const scheduleDownloadUseCase = new ScheduleDownloadUseCase(
    queueRepository,
    resourceRepository,
  );

  const telegramEntrypoint = new TelegramEntrypoint(scheduleDownloadUseCase);
  telegramEntrypoint.start();
};

main();
