import type { QueueRepository } from "../domain/queue";

// status -> number of the user's jobs in that status.
export type GetUserQueueStatusFn = (userId: number) => Promise<Record<string, number>>;

export function createGetUserQueueStatus(queue: QueueRepository): GetUserQueueStatusFn {
  return (userId) => queue.countByStatusForUser(userId);
}
