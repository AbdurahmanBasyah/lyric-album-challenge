export type AlbumSummary = {
  spotifyId: string;
  name: string;
  artistNames: string[];
  imageUrl: string | null;
  totalTracks: number;
};

export type SavedAlbumsPage = {
  items: AlbumSummary[];
  nextCursor: string | null;
};

export type AlbumsApiErrorCode =
  | "AUTH_UNAVAILABLE"
  | "SPOTIFY_AUTH_REQUIRED"
  | "SPOTIFY_RATE_LIMITED"
  | "SPOTIFY_UNAVAILABLE"
  | "INVALID_CURSOR";

export type AlbumsApiError = {
  error: AlbumsApiErrorCode;
};
