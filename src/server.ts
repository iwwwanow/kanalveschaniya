import { TelegramEntrypoint } from './entrypoints';
import 'dotenv/config';

const main = () => {
  console.log('server startup');

  const telegramEntrypoint = new TelegramEntrypoint();
  telegramEntrypoint.start();
};

main();
