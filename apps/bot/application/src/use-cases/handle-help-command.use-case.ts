// src/application/use-cases/handle-help.use-case.ts
export class HandleHelpUseCase {
  execute(): HelpResponse {
    // TODO locales
    const commands = [
      "/start - Начать работу с ботом",
      "/help - Показать список команд",
      "/download <url> - Скачать трек по ссылке",
      "/status - Показать статус загрузок",
    ];

    const helpText = `🎵 **Music Downloader Bot**\n\nДоступные команды:\n${commands.join("\n")}`;

    return new HelpResponse(helpText);
  }
}

export class HelpResponse {
  constructor(public readonly text: string) {}
}
