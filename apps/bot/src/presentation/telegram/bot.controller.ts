export class BotController {
  constructor(private handleCommandUseCase: HandleCommandUseCase) {}

  async handleMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    if (!message?.text) return;

    const command = this.parseCommand(
      message.text,
      message.from?.id.toString(),
      message.chat.id.toString(),
      message.message_id.toString()
    );

    const response = await this.handleCommandUseCase.execute(command);
    
    await this.sendResponse(ctx, response);
  }

  private parseCommand(text: string, userId: string, chatId: string, messageId: string): BotCommand {
    if (text.startsWith('/download')) {
      const url = text.replace('/download', '').trim();
      return BotCommand.createDownload(url, userId, chatId, messageId);
    }
    
    //TODO ... парсинг других команд
  }

  private async sendResponse(ctx: Context, response: BotResponse): Promise<void> {
    switch (response.type) {
      case 'text':
        await ctx.reply(response.text, response.options);
        break;
      case 'audio':
        await ctx.replyWithAudio(
          { source: response.filePath },
          { caption: response.caption }
        );
        break;
    }
  }
}
