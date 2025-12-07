import type { Resource } from '@domain';
import type { ResourceId } from '@domain';
import type { ResourceSourceUrl } from '@domain';
import type { ResourceRepository } from '@domain';

export class ResourceRepositoryImpl implements ResourceRepository {
  async save(resource: Resource): Promise<void> {
    // TODO
  }

  async findById(resourceId: ResourceId): Promise<Resource | null> {
    // TODO
  }

  async findFirstBySourceUrl(
    resourceSourceUrl: ResourceSourceUrl,
  ): Promise<Resource | null> {
    // TODO
  }

  async delete(resourceId: ResourceId): Promise<void> {
    // TODO
  }
}
