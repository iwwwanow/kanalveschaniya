import { Command } from "./base.command";

export class ScheduleDownloadCommand extends Command {
  constructor(
    // TODO valueobject
    public readonly resourceUrl: string,
    // TODO valueobject
    public readonly chatId: string,
    // TODO valueobject
    public readonly messageId: string
  ) {
    super()
  }
}
