// TODO is entity?
export enum BotCommandTypes {
  Start = "start",
  Help = "help",
  Status = "status",
  Download = "download",
}

export class BotCommand {
  constructor(
    public readonly type: BotCommandTypes,
    public readonly userId: string,
    public readonly chatId: string,
    // TODO is needed?
    // public readonly payload: string,
    // public readonly messageId: string
  ) {}

  // TODO is needed?
  // static createDownload(url: string, userId: string, chatId: string, messageId: string): BotCommand {
  //   return new BotCommand('download', url, userId, chatId, messageId);
  // }

  static createStart(userId: string, chatId: string): BotCommand {
    return new BotCommand(BotCommandTypes.Start, userId, chatId);
  }

  static createHelp(userId: string, chatId: string): BotCommand {
    return new BotCommand(BotCommandTypes.Help, userId, chatId);
  }
}
