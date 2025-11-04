import { BotCommand } from '@apps/shared-domain';
// TODO разнести по пакетам
import { HandleHelpUseCase } from '@apps/bot-application';
import { BotResponse } from './bot-response.vo';
import { BotCommandTypes } from '@apps/shared-domain';

export class BotController {
  private helpUseCase: HandleHelpUseCase;

  constructor() {
    this.helpUseCase = new HandleHelpUseCase();
  }

  async handleCommand(command: BotCommand): Promise<BotResponse> {
    switch (command.type) {
      case BotCommandTypes.Help:
        return this.handleHelp(command);
      case BotCommandTypes.Start:
        return this.handleStart(command);
      default:
        return this.handleUnknown(command);
    }
  }

  private async handleHelp(command: BotCommand): Promise<BotResponse> {
    const helpResponse = this.helpUseCase.execute();
    return BotResponse.fromHelp(command.chatId, helpResponse.text);
  }

  private async handleStart(command: BotCommand): Promise<BotResponse> {
    const welcomeText = `🎵 Добро пожаловать в Music Downloader Bot!\n\nИспользуйте /help для просмотра всех команд.`;
    return new BotResponse(command.chatId, welcomeText, { parse_mode: 'Markdown' });
  }

  private async handleUnknown(command: BotCommand): Promise<BotResponse> {
    return new BotResponse(
      command.chatId,
      'Неизвестная команда. Используйте /help для просмотра доступных команд.'
    );
  }
}
