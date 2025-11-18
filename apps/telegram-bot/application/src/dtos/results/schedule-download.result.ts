import type { QueueTask } from "@apps/telegram-bot-domain"
import type { Resource } from "@apps/telegram-bot-domain"

export enum ScheduleDownloadStatus {
  Success = 'success',
  AlreadyDownloaded = 'already_downloaded',
  AlreadyQueued = 'already_queued',
  ValidationError = 'validation_error',
  SystemError = 'system_error',
}

export interface SuccessDto {
  taskId: string
  chatId: string
  messageId: string
  position: number
}

export interface AlreadyQueuedDto {
  taskId: string
  position: number
}

export interface AlreadyDownloadedDto {
  resourceId: string
}

export type ScheduleDownloadResult =
  | { status: ScheduleDownloadStatus.Success; dto: SuccessDto }
  | { status: ScheduleDownloadStatus.AlreadyDownloaded; dto: AlreadyDownloadedDto }
  | { status: ScheduleDownloadStatus.AlreadyQueued; dto: AlreadyQueuedDto }
  | { status: ScheduleDownloadStatus.ValidationError; message: string }
  | { status: ScheduleDownloadStatus.SystemError; message: string };
