import type { QueueTask } from "@apps/telegram-bot-domain"
import type { Resource } from "@apps/telegram-bot-domain"

enum ScheduleDownloadStatus {
  Success = 'success',
  AlreadyDownloaded = 'already_downloaded',
  AlreadyQueued = 'already_queued',
  ValidationError = 'validation_error',
  SystemError = 'system_error',
}

export type ScheduleDownloadResult =
  | { status: ScheduleDownloadStatus.Success; task: QueueTask }
  | { status: ScheduleDownloadStatus.AlreadyDownloaded; resource: Resource }
  | { status: ScheduleDownloadStatus.AlreadyQueued; task: QueueTask }
  | { status: ScheduleDownloadStatus.ValidationError; message: string }
  | { status: ScheduleDownloadStatus.SystemError; message: string };
