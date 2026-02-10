import { ScheduleDownloadUseCase } from './app';
import { TelegramEntrypoint } from './entrypoints';
import 'dotenv/config';

const main = () => {
  console.log('server startup');

  const scheduleDownloadUseCase = new ScheduleDownloadUseCase();

  const telegramEntrypoint = new TelegramEntrypoint(scheduleDownloadUseCase);
  telegramEntrypoint.start();
};

main();
