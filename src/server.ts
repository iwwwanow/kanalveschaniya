import { ScheduleDownloadUseCase } from './app';
import { TelegramEntrypoint } from './entrypoints';
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';

const main = () => {
  console.log('server startup');

  const db = drizzle(process.env.DB_FILE_NAME!);

  const scheduleDownloadUseCase = new ScheduleDownloadUseCase();

  const telegramEntrypoint = new TelegramEntrypoint(scheduleDownloadUseCase);
  telegramEntrypoint.start();
};

main();
