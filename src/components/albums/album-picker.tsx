"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import Link from "next/link";

import type {
    AlbumSummary,
    AlbumsApiErrorCode,
    SavedAlbumsPage,
} from "@/types/albums";
import { createChallengeIntroUrl } from "../challenge/challenge-api";

const ALBUMS_API_ROUTE = "/api/albums";
const INITIAL_REQUEST_KEY = "__initial__";

export type AlbumsLoadState =
    | "loading"
    | "ready"
    | "empty"
    | "unauthenticated"
    | "rate-limited"
    | "error";

export type AlbumsLoadMoreState = "idle" | "loading" | "error";

export type AlbumsRequestError =
    | "unauthenticated"
    | "rate-limited"
    | "error";

export type AlbumsErrorCopy = Readonly<{
    heading: string;
    detail: string;
}>;

const ALBUMS_API_ERROR_CODES: readonly AlbumsApiErrorCode[] = [
    "AUTH_UNAVAILABLE",
    "SPOTIFY_AUTH_REQUIRED",
    "SPOTIFY_RATE_LIMITED",
    "SPOTIFY_UNAVAILABLE",
    "INVALID_CURSOR",
];

const ALBUMS_ERROR_COPY: Readonly<
    Record<AlbumsRequestError, AlbumsErrorCopy>
> = {
    unauthenticated: {
        heading: "Connect Spotify to see your albums.",
        detail:
            "Your saved album library appears here after you sign in with Spotify.",
    },
    "rate-limited": {
        heading: "Spotify needs a moment.",
        detail: "Too many album requests arrived. Try again shortly.",
    },
    error: {
        heading: "We couldn't load your albums.",
        detail: "Please try again. Your Spotify connection stays private to the server.",
    },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isAlbumsApiErrorCode(value: unknown): value is AlbumsApiErrorCode {
    return (
        typeof value === "string" &&
        ALBUMS_API_ERROR_CODES.includes(value as AlbumsApiErrorCode)
    );
}

function parseAlbumSummary(value: unknown): AlbumSummary | null {
    if (!isRecord(value)) {
        return null;
    }

    const { spotifyId, name, artistNames, imageUrl, totalTracks } = value;

    if (
        typeof spotifyId !== "string" ||
        spotifyId.length === 0 ||
        typeof name !== "string" ||
        name.length === 0 ||
        !Array.isArray(artistNames) ||
        !artistNames.every(
            (artistName): artistName is string =>
                typeof artistName === "string" && artistName.length > 0,
        ) ||
        !(imageUrl === null || (typeof imageUrl === "string" && imageUrl.length > 0)) ||
        typeof totalTracks !== "number" ||
        !Number.isInteger(totalTracks) ||
        totalTracks < 0
    ) {
        return null;
    }

    return {
        spotifyId,
        name,
        artistNames: [...artistNames],
        imageUrl,
        totalTracks,
    };
}

/**
 * Validate the provider-neutral album page before it reaches the UI. Any
 * provider-shaped or partially valid payload is rejected as one response.
 */
export function parseAlbumsResponse(payload: unknown): SavedAlbumsPage | null {
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
        return null;
    }

    const items = payload.items.map(parseAlbumSummary);

    if (items.some((album): album is null => album === null)) {
        return null;
    }

    const nextCursor = payload.nextCursor;

    if (
        !(
            nextCursor === null ||
            (typeof nextCursor === "string" && nextCursor.length > 0)
        )
    ) {
        return null;
    }

    return {
        items: items as AlbumSummary[],
        nextCursor,
    };
}

/**
 * Build the only browser request used by the picker. The cursor is encoded as
 * a query value but is otherwise passed through without interpretation.
 */
export function createAlbumsRequestUrl(cursor: string | null): string {
    if (cursor === null) {
        return ALBUMS_API_ROUTE;
    }

    const params = new URLSearchParams();
    params.set("cursor", cursor);
    return `${ALBUMS_API_ROUTE}?${params.toString()}`;
}

/** Keep pages accumulated while avoiding duplicate album cards by stable ID. */
export function appendAlbums(
    existing: readonly AlbumSummary[],
    incoming: readonly AlbumSummary[],
): AlbumSummary[] {
    const knownIds = new Set(existing.map((album) => album.spotifyId));
    const additions = incoming.filter((album) => {
        if (knownIds.has(album.spotifyId)) {
            return false;
        }

        knownIds.add(album.spotifyId);
        return true;
    });

    return [...existing, ...additions];
}

export function parseAlbumsErrorCode(
    payload: unknown,
): AlbumsApiErrorCode | null {
    if (!isRecord(payload) || !isAlbumsApiErrorCode(payload.error)) {
        return null;
    }

    return payload.error;
}

/** Map transport and contract errors to copy-safe UI states. */
export function mapAlbumsError(
    status: number,
    payload: unknown,
): AlbumsRequestError {
    const code = parseAlbumsErrorCode(payload);

    if (status === 401 || code === "SPOTIFY_AUTH_REQUIRED") {
        return "unauthenticated";
    }

    if (status === 429 || code === "SPOTIFY_RATE_LIMITED") {
        return "rate-limited";
    }

    return "error";
}

export function getAlbumsErrorCopy(
    error: AlbumsRequestError,
): AlbumsErrorCopy {
    return ALBUMS_ERROR_COPY[error];
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

function albumArtists(album: AlbumSummary): string {
    return album.artistNames.length > 0
        ? album.artistNames.join(", ")
        : "Unknown artist";
}

function trackCount(totalTracks: number): string {
    return `${totalTracks} ${totalTracks === 1 ? "track" : "tracks"}`;
}

function AlbumCover({ album, priority }: { album: AlbumSummary; priority: boolean }) {
    const artistLabel = albumArtists(album);

    if (!album.imageUrl) {
        return (
            <div
                className="flex aspect-square w-full items-center justify-center rounded-[0.8rem] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(124,245,188,0.16),rgba(140,232,208,0.08))] text-[var(--accent)]"
                role="img"
                aria-label={`No cover art available for ${album.name} by ${artistLabel}`}
            >
                <svg
                    className="h-12 w-12 opacity-80"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    aria-hidden="true"
                >
                    <circle cx="12" cy="12" r="8.5" />
                    <circle cx="12" cy="12" r="2.3" />
                    <path d="M12 3.5v6.2M18.5 12H15" strokeLinecap="round" />
                </svg>
            </div>
        );
    }

    return (
        // Album image hosts are user-library data and are intentionally not
        // hard-coded into next/image remotePatterns for this MVP boundary.
        // eslint-disable-next-line @next/next/no-img-element
        <img
            className="aspect-square w-full rounded-[0.8rem] object-cover"
            src={album.imageUrl}
            alt={`Album cover for ${album.name} by ${artistLabel}`}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
        />
    );
}

function LoadingState() {
    return (
        <div className="space-y-4" aria-label="Loading saved albums">
            <p
                className="text-sm text-[var(--muted-strong)]"
                role="status"
                aria-live="polite"
            >
                Loading your saved albums…
            </p>
            <div
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                aria-hidden="true"
            >
                {Array.from({ length: 5 }, (_, index) => (
                    <div
                        className="space-y-3 rounded-[1.15rem] border border-[var(--border)] bg-[rgba(13,25,29,0.72)] p-3"
                        key={`album-loading-${index}`}
                    >
                        <div className="aspect-square animate-pulse rounded-[0.8rem] bg-[rgba(192,206,202,0.12)]" />
                        <div className="h-4 w-4/5 animate-pulse rounded bg-[rgba(192,206,202,0.12)]" />
                        <div className="h-3 w-3/5 animate-pulse rounded bg-[rgba(192,206,202,0.08)]" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="rounded-[1.35rem] border border-dashed border-[var(--border-strong)] bg-[rgba(13,25,29,0.62)] px-5 py-10 text-center sm:px-8">
            <span
                className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-[var(--border-strong)] bg-[rgba(124,245,188,0.08)] text-[var(--accent)]"
                aria-hidden="true"
            >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M6 5.5h12v13H6zM9 9h6M9 12h6M9 15h3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                No saved albums yet
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted-strong)]">
                Save an album in Spotify and come back when you have a favorite
                ready for a lyric challenge.
            </p>
        </div>
    );
}

function ErrorState({
    error,
    onRetry,
}: {
    error: AlbumsRequestError;
    onRetry: () => void;
}) {
    const copy = getAlbumsErrorCopy(error);

    return (
        <div
            className="rounded-[1.35rem] border border-[var(--border-strong)] bg-[rgba(13,25,29,0.72)] px-5 py-10 text-center sm:px-8"
            role="alert"
        >
            <h3 className="text-lg font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                {copy.heading}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted-strong)]">
                {copy.detail}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                {error === "unauthenticated" ? (
                    <a
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-[rgba(124,245,188,0.45)] bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-ink)] no-underline transition-transform hover:-translate-y-0.5"
                        href="/api/auth/spotify"
                    >
                        Connect with Spotify
                    </a>
                ) : (
                    <button
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-[rgba(124,245,188,0.45)] bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-ink)] transition-transform hover:-translate-y-0.5"
                        type="button"
                        onClick={onRetry}
                    >
                        Try again
                    </button>
                )}
                <Link
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--border-strong)] px-5 text-sm font-semibold text-[var(--muted-strong)] no-underline transition-colors hover:border-[var(--teal)] hover:text-[var(--foreground)]"
                    href="/"
                >
                    Back home
                </Link>
            </div>
        </div>
    );
}

function AlbumCard({
    album,
    index,
    selected,
    onSelect,
}: {
    album: AlbumSummary;
    index: number;
    selected: boolean;
    onSelect: () => void;
}) {
    const artistLabel = albumArtists(album);

    return (
        <motion.button
            className={`group relative flex h-full min-w-0 w-full flex-col rounded-[1.15rem] border p-3 text-left transition-[border-color,background-color,box-shadow] focus-visible:outline-none ${
                selected
                    ? "border-[var(--accent)] bg-[rgba(124,245,188,0.1)] shadow-[0_0_0_3px_rgba(124,245,188,0.12)]"
                    : "border-[var(--border)] bg-[rgba(13,25,29,0.72)] hover:border-[var(--border-strong)] hover:bg-[rgba(18,33,38,0.88)]"
            }`}
            type="button"
            initial={{ opacity: 1, y: 14 }}
            animate={{ opacity: 1, y: 0, scale: selected ? 1.01 : 1 }}
            transition={{ duration: 0.38, delay: Math.min(index * 0.045, 0.24), ease: "easeOut" }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.985 }}
            aria-pressed={selected}
            aria-label={`Select ${album.name} by ${artistLabel}`}
            onClick={onSelect}
        >
            <div className="relative">
                <AlbumCover album={album} priority={index < 4} />
                {selected && (
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-2 py-1 text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--accent-ink)]">
                        <span aria-hidden="true">✓</span>
                        Selected
                    </span>
                )}
            </div>
            <div className="min-w-0 flex-1 pt-3">
                <h3 className="truncate text-[0.96rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                    {album.name}
                </h3>
                <p className="mt-1 truncate text-sm text-[var(--muted-strong)]">
                    {artistLabel}
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                    {trackCount(album.totalTracks)}
                </p>
            </div>
        </motion.button>
    );
}

type InFlightRequest = {
    key: string;
    controller: AbortController;
};

export function AlbumPicker() {
    const [albums, setAlbums] = useState<AlbumSummary[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [status, setStatus] = useState<AlbumsLoadState>("loading");
    const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
    const [loadMoreState, setLoadMoreState] =
        useState<AlbumsLoadMoreState>("idle");
    const [loadMoreMessage, setLoadMoreMessage] = useState<string | null>(null);
    const inFlightRef = useRef<InFlightRequest | null>(null);
    const mountedRef = useRef(true);

    const loadPage = useCallback(
        async (cursor: string | null, append: boolean) => {
            if (inFlightRef.current) {
                return;
            }

            const request: InFlightRequest = {
                key: cursor ?? INITIAL_REQUEST_KEY,
                controller: new AbortController(),
            };
            inFlightRef.current = request;

            if (append) {
                setLoadMoreState("loading");
                setLoadMoreMessage(null);
            } else {
                setStatus("loading");
            }

            try {
                const response = await fetch(createAlbumsRequestUrl(cursor), {
                    method: "GET",
                    credentials: "same-origin",
                    headers: { Accept: "application/json" },
                    cache: "no-store",
                    signal: request.controller.signal,
                });
                let payload: unknown = null;

                try {
                    payload = await response.json();
                } catch {
                    // A non-JSON response is handled as a generic API failure.
                }

                if (!response.ok) {
                    const error = mapAlbumsError(response.status, payload);

                    if (!mountedRef.current) {
                        return;
                    }

                    if (append) {
                        setLoadMoreState("error");
                        setLoadMoreMessage(getAlbumsErrorCopy(error).detail);
                    } else {
                        setStatus(error);
                    }

                    return;
                }

                const page = parseAlbumsResponse(payload);

                if (!page) {
                    if (!mountedRef.current) {
                        return;
                    }

                    if (append) {
                        setLoadMoreState("error");
                        setLoadMoreMessage(getAlbumsErrorCopy("error").detail);
                    } else {
                        setStatus("error");
                    }

                    return;
                }

                if (!mountedRef.current) {
                    return;
                }

                if (append) {
                    setAlbums((current) => appendAlbums(current, page.items));
                    setNextCursor(page.nextCursor);
                    setLoadMoreState("idle");
                    setLoadMoreMessage(null);
                } else {
                    setAlbums(page.items);
                    setNextCursor(page.nextCursor);
                    setStatus(page.items.length > 0 ? "ready" : "empty");
                    setLoadMoreState("idle");
                    setLoadMoreMessage(null);
                }
            } catch (error) {
                if (!mountedRef.current || isAbortError(error)) {
                    return;
                }

                if (append) {
                    setLoadMoreState("error");
                    setLoadMoreMessage(getAlbumsErrorCopy("error").detail);
                } else {
                    setStatus("error");
                }
            } finally {
                if (inFlightRef.current === request) {
                    inFlightRef.current = null;
                }
            }
        },
        [],
    );

    useEffect(() => {
        mountedRef.current = true;
        queueMicrotask(() => {
            if (mountedRef.current) {
                void loadPage(null, false);
            }
        });

        return () => {
            mountedRef.current = false;
            const request = inFlightRef.current;
            request?.controller.abort();
            if (inFlightRef.current === request) {
                inFlightRef.current = null;
            }
        };
    }, [loadPage]);

    const retryInitialLoad = () => {
        void loadPage(null, false);
    };

    const loadMore = () => {
        if (nextCursor !== null) {
            void loadPage(nextCursor, true);
        }
    };

    const hasAlbums = albums.length > 0;
    const selectedAlbum = albums.find(
        (album) => album.spotifyId === selectedAlbumId,
    );

    return (
        <div className="space-y-5">
            {status === "loading" && hasAlbums && (
                <p
                    className="text-sm text-[var(--muted-strong)]"
                    role="status"
                    aria-live="polite"
                >
                    Refreshing your saved albums…
                </p>
            )}

            {status === "loading" && !hasAlbums && <LoadingState />}

            {status === "empty" && <EmptyState />}

            {(status === "unauthenticated" ||
                status === "rate-limited" ||
                status === "error") &&
                !hasAlbums && (
                    <ErrorState error={status} onRetry={retryInitialLoad} />
                )}

            {hasAlbums && (
                <>
                    <div
                        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5"
                        role="list"
                        aria-label="Saved albums"
                    >
                        {albums.map((album, index) => (
                            <div
                                className="min-w-0"
                                key={album.spotifyId}
                                role="listitem"
                            >
                                <AlbumCard
                                    album={album}
                                    index={index}
                                    selected={selectedAlbumId === album.spotifyId}
                                    onSelect={() =>
                                        setSelectedAlbumId((current) =>
                                            current === album.spotifyId
                                                ? null
                                                : album.spotifyId,
                                        )
                                    }
                                />
                            </div>
                        ))}
                    </div>

                    {selectedAlbum && (
                        <div
                            className="flex flex-col gap-3 rounded-[1.15rem] border border-[rgba(124,245,188,0.28)] bg-[rgba(124,245,188,0.07)] p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <p
                                className="text-sm text-[var(--muted-strong)]"
                                role="status"
                                aria-live="polite"
                            >
                                <strong className="text-[var(--foreground)]">
                                    {selectedAlbum.name}
                                </strong>{" "}
                                is ready for a lyric challenge.
                            </p>
                            <Link
                                className="inline-flex min-h-11 flex-none items-center justify-center rounded-full bg-[var(--accent)] px-5 text-sm font-bold text-[var(--accent-ink)] no-underline transition-transform hover:-translate-y-0.5"
                                href={createChallengeIntroUrl({
                                    kind: "album",
                                    spotifyId: selectedAlbum.spotifyId,
                                    displayName: selectedAlbum.name,
                                })}
                            >
                                Continue to setup
                            </Link>
                        </div>
                    )}

                    {nextCursor !== null && (
                        <div className="flex flex-col items-center gap-3 pt-2">
                            {loadMoreMessage && (
                                <p
                                    className="text-sm text-[var(--muted-strong)]"
                                    role="status"
                                    aria-live="polite"
                                >
                                    {loadMoreMessage}
                                </p>
                            )}
                            <button
                                className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--border-strong)] px-5 text-sm font-semibold text-[var(--muted-strong)] transition-colors hover:border-[var(--teal)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                                type="button"
                                onClick={loadMore}
                                disabled={loadMoreState === "loading"}
                                aria-busy={loadMoreState === "loading"}
                            >
                                {loadMoreState === "loading"
                                    ? "Loading more albums…"
                                    : loadMoreState === "error"
                                      ? "Try loading again"
                                      : "Load more albums"}
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
