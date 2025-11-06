import type { TrackDownloader, DownloadResult } from './types';
import { env } from './config';
import { resolveRedirectingURL } from './url';

interface SoundCloudTrack {
  id: number;
  title: string;
  duration: number;
  user: {
    username: string;
  };
  policy: string;
  media: {
    transcodings: Array<{
      url: string;
      preset: string;
      snipped: boolean;
      format: {
        protocol: string;
      };
    }>;
  };
  track_authorization: string;
  artwork_url?: string;
  genre?: string;
  display_date?: string;
  license?: string;
  publisher_metadata?: {
    album_title?: string;
    writer_composer?: string;
  };
}

interface DownloadOptions {
  author?: string;
  song?: string;
  accessKey?: string;
  shortLink?: string;
  format?: 'mp3' | 'opus';
}

interface CachedClientID {
  version: string;
  id: string;
}

const cachedID: CachedClientID = {
  version: '',
  id: ''
};

export class SoundCloudAdapter implements TrackDownloader {
  async download(url: string): Promise<DownloadResult> {
    const result = await this.downloadSoundCloudTrack(url);

    if (result.error) {
      throw new Error(`SoundCloud download failed: ${result.error}`);
    }

    return {
      title: result.fileMetadata.title || 'Unknown Title',
      artist: result.fileMetadata.artist || 'Unknown Artist',
      duration: Math.floor(result.duration / 1000), // Convert ms to seconds
      filePath: result.urls // This will be the download URL
    };
  }

  private async downloadSoundCloudTrack(url: string): Promise<{
    urls: string;
    duration: number;
    fileMetadata: {
      title: string;
      artist: string;
      album?: string;
      composer?: string;
      genre?: string;
      date?: string;
      copyright?: string;
    };
    error?: string;
  }> {
    const clientId = await this.findClientID();
    if (!clientId) {
      return { error: 'Failed to get client ID', urls: '', duration: 0, fileMetadata: { title: '', artist: '' } };
    }

    // Parse URL to extract options
    const options = this.parseSoundCloudUrl(url);

    let finalUrl = url;

    // Handle short links
    if (options.shortLink) {
      const resolved = await resolveRedirectingURL(`https://on.soundcloud.com/${options.shortLink}`);
      if (resolved.author && resolved.song) {
        finalUrl = `https://soundcloud.com/${resolved.author}/${resolved.song}`;
        if (resolved.accessKey) {
          finalUrl += `/s-${resolved.accessKey}`;
        }
      } else {
        return { error: 'Failed to resolve short link', urls: '', duration: 0, fileMetadata: { title: '', artist: '' } };
      }
    }

    // Resolve track info from SoundCloud API
    const resolveURL = new URL('https://api-v2.soundcloud.com/resolve');
    resolveURL.searchParams.set('url', finalUrl);
    resolveURL.searchParams.set('client_id', clientId);

    const json: SoundCloudTrack = await fetch(resolveURL).then(r => r.json()).catch(() => null);
    if (!json) {
      return { error: 'Failed to fetch track info', urls: '', duration: 0, fileMetadata: { title: '', artist: '' } };
    }

    // Validate track
    const validationError = this.validateTrack(json);
    if (validationError) {
      return { error: validationError, urls: '', duration: 0, fileMetadata: { title: '', artist: '' } };
    }

    // Get download URL
    const downloadUrl = await this.getDownloadUrl(json, clientId, options.format);
    if (!downloadUrl) {
      return { error: 'Failed to get download URL', urls: '', duration: 0, fileMetadata: { title: '', artist: '' } };
    }

    // Prepare metadata
    const artist = json.user?.username?.trim() || 'Unknown Artist';
    const fileMetadata = {
      title: json.title?.trim() || 'Unknown Title',
      artist,
      album: json.publisher_metadata?.album_title?.trim(),
      composer: json.publisher_metadata?.writer_composer?.trim(),
      genre: json.genre?.trim(),
      date: json.display_date?.trim()?.slice(0, 10),
      copyright: json.license?.trim(),
    };

    return {
      urls: downloadUrl,
      duration: json.duration,
      fileMetadata
    };
  }

  private async findClientID(): Promise<string | null> {
    try {
      const sc = await fetch('https://soundcloud.com/').then(r => r.text()).catch(() => null);
      if (!sc) return null;

      const versionMatch = sc.match(/<script>window\.__sc_version="([0-9]{10})"<\/script>/);
      if (!versionMatch) return null;

      const scVersion = versionMatch[1];

      if (cachedID.version === scVersion) {
        return cachedID.id;
      }

      const scripts = sc.matchAll(/<script.+src="(.+?)">/g);

      for (const script of scripts) {
        const url = script[1];

        if (!url?.startsWith('https://a-v2.sndcdn.com/')) {
          continue;
        }

        const scriptContent = await fetch(url).then(r => r.text()).catch(() => null);
        if (!scriptContent) continue;

        const idMatch = scriptContent.match(/\("client_id=([A-Za-z0-9]{32})"\)/);
        if (idMatch?.[1]) {
          const clientId = idMatch[1];
          cachedID.version = scVersion;
          cachedID.id = clientId;
          return clientId;
        }
      }
    } catch (error) {
      console.error('Error finding client ID:', error);
    }

    return null;
  }

  private findBestForPreset(
    transcodings: SoundCloudTrack['media']['transcodings'],
    preset: string
  ): SoundCloudTrack['media']['transcodings'][0] | null {
    let inferior: SoundCloudTrack['media']['transcodings'][0] | null = null;

    for (const entry of transcodings) {
      const protocol = entry?.format?.protocol;

      if (entry.snipped || protocol?.includes('encrypted')) {
        continue;
      }

      if (entry?.preset?.startsWith(`${preset}_`)) {
        if (protocol === 'progressive') {
          return entry;
        }
        inferior = entry;
      }
    }

    return inferior;
  }

  private validateTrack(track: SoundCloudTrack): string | null {
    if (track.duration > env.durationLimit * 1000) {
      return 'content.too_long';
    }

    if (track.policy === 'BLOCK') {
      return 'content.region';
    }

    if (track.policy === 'SNIP') {
      return 'content.paid';
    }

    if (!track.media?.transcodings || track.media.transcodings.length === 0) {
      return 'fetch.empty';
    }

    return null;
  }

  private async getDownloadUrl(
    track: SoundCloudTrack,
    clientId: string,
    format?: string
  ): Promise<string | null> {
    let bestAudio = 'opus';
    let selectedStream = this.findBestForPreset(track.media.transcodings, 'opus');

    const mp3Media = this.findBestForPreset(track.media.transcodings, 'mp3');

    // Use mp3 if present if user prefers it or if opus isn't available
    if (mp3Media && (format === 'mp3' || !selectedStream)) {
      selectedStream = mp3Media;
      bestAudio = 'mp3';
    }

    if (!selectedStream) {
      return null;
    }

    const fileUrl = new URL(selectedStream.url);
    fileUrl.searchParams.set('client_id', clientId);
    fileUrl.searchParams.set('track_authorization', track.track_authorization);

    const fileResponse = await fetch(fileUrl)
      .then(async r => {
        const data = await r.json();
        return new URL(data.url);
      })
      .catch(() => null);

    return fileResponse?.toString() || null;
  }

  private parseSoundCloudUrl(url: string): DownloadOptions {
    const options: DownloadOptions = {};

    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);

      if (urlObj.hostname === 'on.soundcloud.com') {
        options.shortLink = pathParts[0];
      } else if (urlObj.hostname === 'soundcloud.com') {
        if (pathParts.length >= 2) {
          options.author = pathParts[0];
          options.song = pathParts[1];
        }

        // Check for access key (s- prefix)
        const accessKeyMatch = url.match(/\/s-([A-Za-z0-9]+)/);
        if (accessKeyMatch) {
          options.accessKey = accessKeyMatch[1];
        }
      }
    } catch (error) {
      console.error('Error parsing SoundCloud URL:', error);
    }

    return options;
  }
}
