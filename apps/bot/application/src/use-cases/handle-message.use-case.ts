export class MessageResponse {
  constructor(public readonly text: string) { }
}

export class HandleMessageUseCase {
  execute(): MessageResponse {
    // TODO locales
    const commands = [
      "/start - Начать работу с ботом",
      "/help - Показать список команд",
      "/download <url> - Скачать трек по ссылке",
      "/status - Показать статус загрузок",
    ];

    const helpText = `🎵 **Music Downloader Bot**\n\nДоступные команды:\n${commands.join("\n")}`;

    return new MessageResponse(helpText);
  }
}
