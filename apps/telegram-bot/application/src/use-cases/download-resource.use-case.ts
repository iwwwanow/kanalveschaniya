import type { Resource } from "@apps/telegram-bot-domain";
import type { QueueTask } from "@apps/telegram-bot-domain";
import type { QueueRepository } from "@apps/telegram-bot-domain";
import type { ResourceRepository } from "@apps/telegram-bot-domain";

export class DownloadResourceUseCase {
  constructor(
    public readonly queueRepository: QueueRepository,
    public readonly resourceRepository: ResourceRepository,
  ) { }

  // TODO return type?
  execute(): any {
    // 1. check is downloaded previosly?

    // 2. check is qurrently in queue?

    // 3. add to queue
  }
}
