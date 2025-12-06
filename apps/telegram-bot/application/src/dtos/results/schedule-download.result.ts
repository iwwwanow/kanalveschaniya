export enum ScheduleDownloadStatus {
  Success = 'success',
  AlreadyDownloaded = 'already_downloaded',
  AlreadyQueued = 'already_queued',
  ValidationError = 'validation_error',
  SystemError = 'system_error',
}

export interface SuccessDto {
  taskId: string;
  chatId: string;
  messageId: string;
  position: number;
}

export interface AlreadyQueuedDto {
  taskId: string;
  position: number;
}

export interface AlreadyDownloadedDto {
  resourceId: string;
}

// TODO refactor
export interface ScheduleDownloadSuccessResult {
  status: ScheduleDownloadStatus.Success;
  dto: SuccessDto;
}

// TODO refactor
export type ScheduleDownloadResult =
  | ScheduleDownloadSuccessResult
  | {
      status: ScheduleDownloadStatus.AlreadyDownloaded;
      dto: AlreadyDownloadedDto;
    }
  | { status: ScheduleDownloadStatus.AlreadyQueued; dto: AlreadyQueuedDto }
  | {
      status: ScheduleDownloadStatus.ValidationError;
      message: string;
    }
  | {
      status: ScheduleDownloadStatus.SystemError;
      message: string;
    };
