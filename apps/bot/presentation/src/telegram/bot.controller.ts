import { BotCommand } from "@apps/shared-domain";
import { HandleHelpCommandUseCase } from "@apps/bot-application";
import { HandleStartCommandUseCase } from "@apps/bot-application";
import { HandleMessageUseCase } from "@apps/bot-application";
// TODO разнести по пакетам
import { BotResponse } from "./bot-response.vo";
import { BotCommandTypes } from "@apps/shared-domain";

export class BotController {
  private startCommandUseCase: HandleStartCommandUseCase;
  private helpCommandUseCase: HandleHelpCommandUseCase;
  private messageUseCase: HandleMessageUseCase;

  constructor() {
    this.startCommandUseCase = new HandleStartCommandUseCase();
    this.helpCommandUseCase = new HandleHelpCommandUseCase();
    this.messageUseCase = new HandleMessageUseCase();
  }

  async handleCommand(command: BotCommand): Promise<BotResponse> {
    switch (command.type) {
      case BotCommandTypes.Help:
        return this.handleHelp(command);
      case BotCommandTypes.Start:
        return this.handleStart(command);
      case BotCommandTypes.Message:
        return this.handleMessage(command);
      default:
        return this.handleUnknown(command);
    }
  }

  private async handleHelp(command: BotCommand): Promise<BotResponse> {
    const helpResponse = this.helpCommandUseCase.execute();
    return BotResponse.fromHelp(command.chatId, helpResponse.text);
  }

  private async handleStart(command: BotCommand): Promise<BotResponse> {
    const startResponse = this.startCommandUseCase.execute();
    return BotResponse.fromStart(command.chatId, startResponse.text);
  }

  private async handleMessage(command: BotCommand): Promise<BotResponse> {
    const messageResponse = this.messageUseCase.execute(command.payload);
    return BotResponse.fromMessage(command.chatId, messageResponse.text);
  }

  private async handleUnknown(command: BotCommand): Promise<BotResponse> {
    return BotResponse.fromUnknown(command.chatId);
  }
}
