// TODO расширить тип. это то, что падает в репозиторий в конечном итоге
export interface DownloadResult {
  success: boolean;
  filename?: string;
  filePath?: string;
  error?: string;
  // TODO
  // metadata?: FileMetadata;
}
