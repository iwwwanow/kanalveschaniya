export class BotResponse {
  constructor(
    public readonly type: 'text' | 'audio',
    public readonly chatId: string,
    public readonly text?: string,
    public readonly filePath?: string,
    public readonly caption?: string,
    public readonly options?: any
  ) {}

  static downloadStarted(chatId: string, title: string, cached: boolean): BotResponse {
    const status = cached ? 'из кэша' : 'начато скачивание';
    return new BotResponse(
      'text',
      chatId,
      `🎵 "${title}" - ${status}`
    );
  }

  static audioReady(chatId: string, filePath: string, title: string): BotResponse {
    return new BotResponse(
      'audio',
      chatId,
      undefined,
      filePath,
      `🎵 ${title}`
    );
  }
}
