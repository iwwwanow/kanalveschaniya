// Every failed attempt, not just the last one — queue.error only keeps the latest.
export interface ErrorLogRepository {
  add(jobId: number, url: string, error: string): Promise<void>;
}
