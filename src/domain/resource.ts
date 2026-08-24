export interface Track {
  trackId: string;
  url: string;
  title: string;
  duration: number;
}

export interface ResourceRepository {
  findByTrackId(trackId: string): Promise<Track | null>;
  save(track: Track): Promise<void>;
}
