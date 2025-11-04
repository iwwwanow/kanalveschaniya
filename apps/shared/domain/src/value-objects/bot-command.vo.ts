// TODO is entity?
export enum BotCommandTypes {
  Start = "start",
  Help = "help",
  Status = "status",
  Download = "download",
  Message = "message",
}

export class BotCommand {
  constructor(
    public readonly type: BotCommandTypes,
    public readonly userId: string,
    public readonly chatId: string,
    public readonly payload?: string,
    // public readonly messageId: string
  ) {}

  static createStart(userId: string, chatId: string): BotCommand {
    return new BotCommand(BotCommandTypes.Start, userId, chatId);
  }

  static createHelp(userId: string, chatId: string): BotCommand {
    return new BotCommand(BotCommandTypes.Help, userId, chatId);
  }

  static createMessage(
    userId: string,
    chatId: string,
    text: string,
  ): BotCommand {
    return new BotCommand(BotCommandTypes.Message, userId, chatId, text);
  }
}
