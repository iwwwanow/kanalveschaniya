import type { QueueRepository } from '../storage';
import type { ResourceRepository } from '../storage';

export class ScheduleDownloadUseCase {
  private queueRepository: QueueRepository;
  private resourceRepository: ResourceRepository;

  constructor(
    queueRepository: QueueRepository,
    resourceRepository: ResourceRepository,
  ) {
    this.queueRepository = queueRepository;
    this.resourceRepository = resourceRepository;
  }

  async execute(url: string) {
    const existing = await this.resourceRepository.findByUrl(url);

    let resourceId: number;
    if (existing) {
      if (existing.status === 'error') {
        await this.resourceRepository.updateStatus(existing.id, 'pending');
        resourceId = existing.id;
      } else {
        return;
      }
    } else {
      const newResource = await this.resourceRepository.create(url);
      resourceId = newResource.id;
    }

    await this.queueRepository.add(resourceId);
  }
}
