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
  ) {}

  static fromHelp(chatId: string, helpText: string): BotResponse {
    return new BotResponse(chatId, helpText, { parse_mode: "Markdown" });
  }

  // TODO
  // static downloadStarted(chatId: string, title: string, cached: boolean): BotResponse {
  //   const status = cached ? 'из кэша' : 'начато скачивание';
  //   return new BotResponse(
  //     'text',
  //     chatId,
  //     `🎵 "${title}" - ${status}`
  //   );
  // }
  //
  // static audioReady(chatId: string, filePath: string, title: string): BotResponse {
  //   return new BotResponse(
  //     'audio',
  //     chatId,
  //     undefined,
  //     filePath,
  //     `🎵 ${title}`
  //   );
  // }
}
