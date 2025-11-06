import { DownloadTrackUseCase } from '@apps/shared-application'
import { BotCommand } from "@apps/shared-domain";
// TODO! domain
import { BotResponse } from '../../../presentation/src/telegram';

export class MessageResponse {
  constructor(public readonly text: string) { }
}

export class HandleMessageUseCase {
  constructor(
    private downloadTrackUseCase: DownloadTrackUseCase = new DownloadTrackUseCase()) { }

  async execute(command: BotCommand): Promise<MessageResponse> {
    // TODO locales
    // const messageResponse = `message-response`;
    // return new MessageResponse(messageResponse);
    const text = command.payload

    if (this.isValidUrl(text)) {
      return await this.handleDownload(command, text);
    } else {
      // TODO locales
      return new MessageResponse('url incorrect');
    }
  }

  private async handleDownload(command: BotCommand, url: string): Promise<BotResponse> {
    console.log('handle download')
    try {
      debugger;
      const result = await this.downloadTrackUseCase.execute(
        url,
        command.userId,
        command.chatId
      );

      if (result.cached) {
        return new BotResponse(
          command.chatId,
          `🎵 "${result.track.title}" - найдено в кэше\n\nОтправляю трек...`
        );
      } else {
        return new BotResponse(
          command.chatId,
          `🎵 "${result.track.title}" - скачивание завершено\n\nОтправляю трек...`
        );
      }
    } catch (error) {
      return new BotResponse(
        command.chatId,
        `❌ Ошибка при скачивании: ${error.message}\n\nПопробуйте другую ссылку или используйте /help`
      );
    }
  }

  private isValidUrl(text: string): boolean {
    try {
      const url = new URL(text);
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }
}
