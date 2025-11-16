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
  // TODO input execute type? || or pass Resource?
  execute(resourceUrl: string): any {
    // 1. check is downloaded previosly?

    // 2. check is qurrently in queue?

    // 3. add to queue
  }

  private checkResourceDownloaded(): boolean {

  }

  // TODO naming
  private checkResourceInQueue(): boolean {

  }

  // TODO naming
  // TODO type
  private addResourceToQueue(): void {

  }
}
