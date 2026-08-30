export type PlaylistSummary = {
  spotifyId: string;
  name: string;
  ownerName: string | null;
  imageUrl: string | null;
  totalItems: number | null;
  itemsAvailable: boolean;
  isPublic: boolean | null;
  spotifyUrl: string;
};

export type SavedPlaylistsPage = {
  items: PlaylistSummary[];
  nextCursor: string | null;
};

export type PlaylistsApiErrorCode =
  | "AUTH_UNAVAILABLE"
  | "SPOTIFY_AUTH_REQUIRED"
  | "SPOTIFY_SCOPE_REQUIRED"
  | "SPOTIFY_RATE_LIMITED"
  | "SPOTIFY_UNAVAILABLE"
  | "INVALID_CURSOR";

export type PlaylistsApiError = {
  error: PlaylistsApiErrorCode;
};
