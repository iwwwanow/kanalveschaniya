import type { Resource } from '../entities';
import type { ResourceId } from '../value-objects';
import type { ResourceSourceUrl } from '../value-objects';

export interface ResourceRepository {
  save(resource: Resource): Promise<void>;
  findById(resourceId: ResourceId): Promise<Resource | null>;
  findBySourceUrl(
    resourceSourceUrl: ResourceSourceUrl,
  ): Promise<Resource | null>;
  delete(resourceId: ResourceId): Promise<void>;
}
