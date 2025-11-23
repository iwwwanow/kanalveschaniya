import { ResourceSourceUrl } from "@apps/telegram-bot-domain";
import type { DownloadResult } from "../dtos";

export interface DownloadAdapter {
  download(resourceUrl: ResourceSourceUrl): Promise<DownloadResult>;
}
