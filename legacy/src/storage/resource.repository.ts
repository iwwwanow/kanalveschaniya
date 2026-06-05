import type { DB } from './client';
import { resources } from './schema';
import type { Resource } from './schema';
import { eq } from 'drizzle-orm';

export class ResourceRepository {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  async create(url: string): Promise<Resource | undefined> {
    const [res] = await this.db.insert(resources).values({ url }).returning();
    return res;
  }

  async findByUrl(url: string): Promise<Resource | null> {
    const [res] = await this.db
      .select()
      .from(resources)
      .where(eq(resources.url, url));
    return res || null;
  }

  async updateStatus(id: number, status: Resource['status']): Promise<void> {
    await this.db
      .update(resources)
      .set({ status, dateUpdated: new Date() })
      .where(eq(resources.id, id));
  }
}
