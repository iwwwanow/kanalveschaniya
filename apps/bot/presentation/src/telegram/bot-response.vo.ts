export class BotResponse {
  constructor(
    public readonly chatId: string,
    public readonly text: string,
    // TODO any type
    public readonly options?: any,
    // TODO
    // public readonly type: 'text' | 'audio',
    // public readonly filePath?: string,
    // public readonly caption?: string,
  ) { }

  static fromStart(chatId: string, helpText: string): BotResponse {
    return new BotResponse(chatId, helpText, { parse_mode: "Markdown" });
  }

  static fromHelp(chatId: string, startText: string): BotResponse {
    return new BotResponse(chatId, startText, { parse_mode: "Markdown" });
  }

  static fromMessage(chatId: string, messageText: string): BotResponse {
    return new BotResponse(chatId, messageText, { parse_mode: "Markdown" });
  }

  // TODO is it VO?
  static fromUnknown(chatId: string): BotResponse {
    return new BotResponse(
      chatId,
      "Неизвестная команда. Используйте /help для просмотра доступных команд.",
    );
  }
}
