export class BotCommand {
  constructor(
    public readonly type: 'download' | 'status' | 'help',
    public readonly payload: string,
    public readonly userId: string,
    public readonly chatId: string,
    public readonly messageId: string
  ) {}
  
  static createDownload(url: string, userId: string, chatId: string, messageId: string): BotCommand {
    return new BotCommand('download', url, userId, chatId, messageId);
  }
}
