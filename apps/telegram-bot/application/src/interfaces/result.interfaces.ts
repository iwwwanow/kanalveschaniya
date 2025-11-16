import type { QueueTask } from "@apps/telegram-bot-domain"
import type { Resource } from "@apps/telegram-bot-domain"

export enum ResultStatus {
  Downloaded = 'downloaded',
  InQueue = 'in-queue',
  AddedToQueue = 'added-to-queue',
  ValidationError = 'validation-error',
}

// TODO generic?
export interface Result {
  status: ResultStatus
  resource?: Resource,
  queueTask?: QueueTask,
  // TODO type
  message?: string,
}
