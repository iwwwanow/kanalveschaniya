export class HandleCommandUseCase {
  constructor(
    private downloadTrackUseCase: DownloadTrackUseCase,
    private messageBus: MessageBus
  ) {}

  async execute(command: BotCommand): Promise<BotResponse> {
    switch (command.type) {
      case 'download':
        return await this.handleDownload(command);
      case 'status':
        return await this.handleStatus(command);
      default:
        return BotResponse.help(command.chatId);
    }
  }

  private async handleDownload(command: BotCommand): Promise<BotResponse> {
    try {
      const result = await this.downloadTrackUseCase.execute(
        command.payload,
        command.userId,
        command.chatId
      );

      await this.messageBus.publish('track.downloaded', {
        trackId: result.track.id,
        userId: command.userId,
        chatId: command.chatId,
        cached: result.cached
      });

      return BotResponse.downloadStarted(
        command.chatId,
        result.track.title,
        result.cached
      );
    } catch (error) {
      return BotResponse.error(command.chatId, error.message);
    }
  }
}
