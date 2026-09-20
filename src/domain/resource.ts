export interface Resource {
  resourceId: string;
  url: string;
  title: string;
  duration: number;
}

export interface ResourceRepository {
  findByResourceId(resourceId: string): Promise<Resource | null>;
  save(resource: Resource): Promise<void>;
}
