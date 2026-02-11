import type { DownloaderPort } from '../app';
import type { DownloaderResult } from '../app/downloader.interfaces';

// TODO: interfaces
interface CobaltResponse {
  status: 'success' | 'error';
  text?: string;
  url?: string;
  error?: string;
}

export class CobaltAdapter implements DownloaderPort {
  private readonly cobaltUrl: string;

  constructor() {
    // COBALT_URL должен быть задан в .env
    // Например: http://cobalt:9000/api/json
    this.cobaltUrl = process.env.COBALT_URL || 'http://localhost:9000/api/json';
  }

  async download(url: string): Promise<DownloaderResult> {
    try {
      console.log(`[CobaltAdapter] Sending request to Cobalt for URL: ${url}`);

      const response = await fetch(this.cobaltUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          url: url,
          // Дополнительные параметры Cobalt (опционально)
          // audioBitrate: '192',
          // isAudioOnly: false,
          // ...
        }),
        // Таймаут на случай зависания
        signal: AbortSignal.timeout(60_000), // 60 секунд
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: CobaltResponse = await response.json();

      if (data.status === 'success') {
        const filePath = data.url || data.text;
        console.log(`[CobaltAdapter] Success - file path: ${filePath}`);

        return {
          success: true,
          filePath: filePath || undefined,
        };
      } else {
        const errorMessage = data.error || 'Unknown Cobalt error';
        console.error(`[CobaltAdapter] Cobalt returned error: ${errorMessage}`);

        return {
          success: false,
          error: errorMessage,
        };
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error(`[CobaltAdapter] Request timeout for URL: ${url}`);
        return {
          success: false,
          error: 'Request timeout (60s)',
        };
      }

      console.error(`[CobaltAdapter] Network error for URL ${url}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown network error',
      };
    }
  }
}
