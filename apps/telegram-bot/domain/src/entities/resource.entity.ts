import { Entity } from "./base.entity";

import type { ResourceId } from "../value-objects";

export class Resource extends Entity<ResourceId> {
  constructor(
    public resourceId: ResourceId,
    // TODO filepath?
    public readonly filename: string,
    public readonly sourceUrl: string
  ) {
    super(resourceId)
  }

  isValid(): boolean {
    // TODO need details on url check and filename check; refactor it
    return this.filename.length > 0 && this.sourceUrl.toString().length > 0;
  }
}
