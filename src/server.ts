import { TelegramEntrypoint } from './entrypoints';

const main = () => {
  console.log('server startup');

  const telegramEntrypoint = new TelegramEntrypoint();
  telegramEntrypoint.start();
};

main();
