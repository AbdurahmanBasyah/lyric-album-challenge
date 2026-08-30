"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import Link from "next/link";

import type {
    PlaylistSummary,
    PlaylistsApiErrorCode,
    SavedPlaylistsPage,
} from "@/types/playlists";
import { createChallengeIntroUrl } from "../challenge/challenge-api";

const PLAYLISTS_API_ROUTE = "/api/playlists";
export const SPOTIFY_REAUTHORIZE_ROUTE = "/api/auth/spotify?reauthorize=1";
const INITIAL_REQUEST_KEY = "__initial__";
const DUPLICATE_CURSOR_MESSAGE =
    "We couldn't load another page of playlists. Please try again later.";

export type PlaylistsLoadState =
    | "loading"
    | "ready"
    | "empty"
    | "unauthenticated"
    | "scope-required"
    | "rate-limited"
    | "unavailable"
    | "error";

export type PlaylistsLoadMoreState = "idle" | "loading" | "error";

export type PlaylistsRequestError =
    | "unauthenticated"
    | "scope-required"
    | "rate-limited"
    | "unavailable"
    | "error";

export type PlaylistsErrorCopy = Readonly<{
    heading: string;
    detail: string;
}>;

const PLAYLISTS_API_ERROR_CODES: readonly PlaylistsApiErrorCode[] = [
    "AUTH_UNAVAILABLE",
    "SPOTIFY_AUTH_REQUIRED",
    "SPOTIFY_SCOPE_REQUIRED",
    "SPOTIFY_RATE_LIMITED",
    "SPOTIFY_UNAVAILABLE",
    "INVALID_CURSOR",
];

const PLAYLISTS_ERROR_COPY: Readonly<
    Record<PlaylistsRequestError, PlaylistsErrorCopy>
> = {
    unauthenticated: {
        heading: "Connect Spotify to see your playlists.",
        detail:
            "Your playlist library appears here after you sign in with Spotify.",
    },
    "scope-required": {
        heading: "Reconnect Spotify to load your playlists.",
        detail:
            "Your current connection needs playlist access. Reconnect to grant the private and collaborative playlist permissions.",
    },
    "rate-limited": {
        heading: "Spotify needs a moment.",
        detail: "Too many playlist requests arrived. Try again shortly.",
    },
    unavailable: {
        heading: "Spotify couldn't load your playlists right now.",
        detail: "Spotify is temporarily unavailable. Try again in a moment.",
    },
    error: {
        heading: "We couldn't load your playlists.",
        detail:
            "Please try again. Your Spotify connection stays private to the server.",
    },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isPlaylistsApiErrorCode(
    value: unknown,
): value is PlaylistsApiErrorCode {
    return (
        typeof value === "string" &&
        PLAYLISTS_API_ERROR_CODES.includes(value as PlaylistsApiErrorCode)
    );
}

function isSafeSpotifyPlaylistUrl(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0) {
        return false;
    }

    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            url.hostname === "open.spotify.com" &&
            /^\/playlist\/[^/]+\/?$/.test(url.pathname)
        );
    } catch {
        return false;
    }
}

function parsePlaylistSummary(value: unknown): PlaylistSummary | null {
    if (!isRecord(value)) {
        return null;
    }

    const {
        spotifyId,
        name,
        ownerName,
        imageUrl,
        totalItems,
        itemsAvailable,
        isPublic,
        spotifyUrl,
    } = value;

    if (
        typeof spotifyId !== "string" ||
        spotifyId.length === 0 ||
        typeof name !== "string" ||
        name.length === 0 ||
        !(ownerName === null ||
            (typeof ownerName === "string" && ownerName.length > 0)) ||
        !(imageUrl === null ||
            (typeof imageUrl === "string" && imageUrl.length > 0)) ||
        !(totalItems === null ||
            (typeof totalItems === "number" &&
                Number.isSafeInteger(totalItems) &&
                totalItems >= 0)) ||
        typeof itemsAvailable !== "boolean" ||
        (totalItems === null) !== !itemsAvailable ||
        !(isPublic === null || typeof isPublic === "boolean") ||
        !isSafeSpotifyPlaylistUrl(spotifyUrl)
    ) {
        return null;
    }

    return {
        spotifyId,
        name,
        ownerName,
        imageUrl,
        totalItems,
        itemsAvailable,
        isPublic,
        spotifyUrl,
    };
}

/**
 * Validate the provider-neutral playlist page before it reaches the UI. A
 * provider-shaped or partially valid payload is rejected as one response.
 */
export function parsePlaylistsResponse(
    payload: unknown,
): SavedPlaylistsPage | null {
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
        return null;
    }

    const items = payload.items.map(parsePlaylistSummary);

    if (items.some((playlist): playlist is null => playlist === null)) {
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
        items: items as PlaylistSummary[],
        nextCursor,
    };
}

/** Build the only browser request used by the playlist picker. */
export function createPlaylistsRequestUrl(cursor: string | null): string {
    if (cursor === null) {
        return PLAYLISTS_API_ROUTE;
    }

    const params = new URLSearchParams();
    params.set("cursor", cursor);
    return `${PLAYLISTS_API_ROUTE}?${params.toString()}`;
}

/** Keep pages accumulated while avoiding duplicate playlist cards by ID. */
export function appendPlaylists(
    existing: readonly PlaylistSummary[],
    incoming: readonly PlaylistSummary[],
): PlaylistSummary[] {
    const knownIds = new Set(existing.map((playlist) => playlist.spotifyId));
    const additions = incoming.filter((playlist) => {
        if (knownIds.has(playlist.spotifyId)) {
            return false;
        }

        knownIds.add(playlist.spotifyId);
        return true;
    });

    return [...existing, ...additions];
}

export function parsePlaylistsErrorCode(
    payload: unknown,
): PlaylistsApiErrorCode | null {
    if (!isRecord(payload) || !isPlaylistsApiErrorCode(payload.error)) {
        return null;
    }

    return payload.error;
}

/** Map transport and contract errors to copy-safe UI states. */
export function mapPlaylistsError(
    status: number,
    payload: unknown,
): PlaylistsRequestError {
    if (status === 401) {
        return "unauthenticated";
    }

    if (status === 403) {
        return "scope-required";
    }

    if (status === 429) {
        return "rate-limited";
    }

    const code = parsePlaylistsErrorCode(payload);

    if (status === 502 || code === "SPOTIFY_UNAVAILABLE") {
        return "unavailable";
    }

    if (code === "SPOTIFY_AUTH_REQUIRED") {
        return "unauthenticated";
    }

    if (code === "SPOTIFY_SCOPE_REQUIRED") {
        return "scope-required";
    }

    if (code === "SPOTIFY_RATE_LIMITED") {
        return "rate-limited";
    }

    return "error";
}

export function getPlaylistsErrorCopy(
    error: PlaylistsRequestError,
): PlaylistsErrorCopy {
    return PLAYLISTS_ERROR_COPY[error];
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

function playlistOwner(playlist: PlaylistSummary): string {
    return playlist.ownerName ? `By ${playlist.ownerName}` : "Spotify playlist";
}

function itemCount(totalItems: number | null): string {
    if (totalItems === null) {
        return "Track details unavailable";
    }

    return `${totalItems} ${totalItems === 1 ? "item" : "items"}`;
}

function PlaylistCover({
    playlist,
    priority,
}: {
    playlist: PlaylistSummary;
    priority: boolean;
}) {
    const [imageFailed, setImageFailed] = useState(false);

    if (!playlist.imageUrl || imageFailed) {
        return (
            <div
                className="flex aspect-square w-full items-center justify-center rounded-[0.8rem] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(140,232,208,0.16),rgba(124,245,188,0.08))] text-[var(--teal)]"
                role="img"
                aria-label={`No cover art available for ${playlist.name}`}
            >
                <svg
                    className="h-12 w-12 opacity-80"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    aria-hidden="true"
                >
                    <path
                        d="M5 5.5h14v13H5zM8 8.5h8M8 12h8M8 15.5h5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </div>
        );
    }

    return (
        // Playlist image hosts are user-library data and are intentionally not
        // hard-coded into next/image remotePatterns for this MVP boundary.
        // eslint-disable-next-line @next/next/no-img-element
        <img
            className="aspect-square w-full rounded-[0.8rem] object-cover"
            src={playlist.imageUrl}
            alt={`Cover art for playlist ${playlist.name}`}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            onError={() => setImageFailed(true)}
        />
    );
}

function LoadingState() {
    return (
        <div className="space-y-4" aria-label="Loading playlists">
            <p
                className="text-sm text-[var(--muted-strong)]"
                role="status"
                aria-live="polite"
            >
                Loading your playlists…
            </p>
            <div
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                aria-hidden="true"
            >
                {Array.from({ length: 5 }, (_, index) => (
                    <div
                        className="space-y-3 rounded-[1.15rem] border border-[var(--border)] bg-[rgba(13,25,29,0.72)] p-3"
                        key={`playlist-loading-${index}`}
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
                className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-[var(--border-strong)] bg-[rgba(124,245,188,0.08)] text-[var(--teal)]"
                aria-hidden="true"
            >
                <svg
                    viewBox="0 0 24 24"
                    className="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                >
                    <path
                        d="M6 5.5h12v13H6zM9 9h6M9 12h6M9 15h3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                No playlists available yet
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted-strong)]">
                Create or follow a playlist in Spotify, then come back when you
                have a favorite ready for a lyric challenge.
            </p>
        </div>
    );
}

function ErrorState({
    error,
    onRetry,
}: {
    error: PlaylistsRequestError;
    onRetry: () => void;
}) {
    const copy = getPlaylistsErrorCopy(error);

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
                {error === "scope-required" ? (
                    <a
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-[rgba(124,245,188,0.45)] bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--accent-ink)] no-underline transition-transform hover:-translate-y-0.5"
                        href={SPOTIFY_REAUTHORIZE_ROUTE}
                    >
                        Reconnect Spotify
                    </a>
                ) : error === "unauthenticated" ? (
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

function PlaylistCard({
    playlist,
    index,
    selected,
    onSelect,
}: {
    playlist: PlaylistSummary;
    index: number;
    selected: boolean;
    onSelect: () => void;
}) {
    const ownerLabel = playlistOwner(playlist);
    const availabilityHintId = `playlist-access-${playlist.spotifyId}`;

    return (
        <motion.article
            className="flex h-full min-w-0 flex-col rounded-[1.15rem] border border-[var(--border)] bg-[rgba(13,25,29,0.72)] p-3 transition-[border-color,background-color,box-shadow] hover:border-[var(--border-strong)] hover:bg-[rgba(18,33,38,0.88)]"
            initial={{ opacity: 1, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
                duration: 0.38,
                delay: Math.min(index * 0.045, 0.24),
                ease: "easeOut",
            }}
            whileHover={{ y: -3 }}
            layout
        >
            <button
                className={`group relative flex min-w-0 flex-1 flex-col rounded-[0.85rem] text-left focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70 ${
                    selected
                        ? "rounded-[0.95rem] ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]"
                        : ""
                }`}
                type="button"
                aria-pressed={selected}
                aria-disabled={!playlist.itemsAvailable}
                aria-describedby={
                    playlist.itemsAvailable ? undefined : availabilityHintId
                }
                disabled={!playlist.itemsAvailable}
                aria-label={`Select playlist ${playlist.name}${playlist.ownerName ? ` by ${playlist.ownerName}` : ""}`}
                onClick={onSelect}
            >
                <div className="relative">
                    <PlaylistCover playlist={playlist} priority={index < 4} />
                    {selected && (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-2 py-1 text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--accent-ink)]">
                            <span aria-hidden="true">✓</span>
                            Selected
                        </span>
                    )}
                </div>
                <div className="min-w-0 flex-1 pt-3">
                    <h3 className="truncate text-[0.96rem] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                        {playlist.name}
                    </h3>
                    <p className="mt-1 truncate text-sm text-[var(--muted-strong)]">
                        {ownerLabel}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                        {itemCount(playlist.totalItems)}
                    </p>
                    {!playlist.itemsAvailable && (
                        <p
                            className="mt-2 text-xs leading-5 text-[var(--muted-strong)]"
                            id={availabilityHintId}
                        >
                            This playlist must be owned or collaborative to
                            provide track details for a challenge.
                        </p>
                    )}
                </div>
            </button>
            <a
                className="mt-3 inline-flex min-h-10 items-center justify-center gap-1 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--muted-strong)] no-underline transition-colors hover:border-[var(--teal)] hover:text-[var(--foreground)]"
                href={playlist.spotifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${playlist.name} on Spotify (opens in a new tab)`}
            >
                Open in Spotify
                <span aria-hidden="true">↗</span>
            </a>
        </motion.article>
    );
}

type InFlightRequest = {
    cursor: string | null;
    controller: AbortController;
};

export function PlaylistPicker() {
    const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [status, setStatus] = useState<PlaylistsLoadState>("loading");
    const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
        null,
    );
    const [loadMoreState, setLoadMoreState] =
        useState<PlaylistsLoadMoreState>("idle");
    const [loadMoreMessage, setLoadMoreMessage] = useState<string | null>(null);
    const [loadMoreError, setLoadMoreError] =
        useState<PlaylistsRequestError | null>(null);
    const inFlightRef = useRef<InFlightRequest | null>(null);
    const completedCursorsRef = useRef<Set<string>>(new Set());
    const mountedRef = useRef(true);

    const loadPage = useCallback(
        async (cursor: string | null, append: boolean) => {
            if (inFlightRef.current) {
                return;
            }

            if (
                append &&
                cursor !== null &&
                completedCursorsRef.current.has(cursor)
            ) {
                setLoadMoreState("error");
                setLoadMoreError("error");
                setLoadMoreMessage(DUPLICATE_CURSOR_MESSAGE);
                return;
            }

            const request: InFlightRequest = {
                cursor,
                controller: new AbortController(),
            };
            inFlightRef.current = request;

            if (append) {
                setLoadMoreState("loading");
                setLoadMoreMessage(null);
                setLoadMoreError(null);
            } else {
                setStatus("loading");
            }

            try {
                const response = await fetch(createPlaylistsRequestUrl(cursor), {
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
                    const error = mapPlaylistsError(response.status, payload);

                    if (!mountedRef.current) {
                        return;
                    }

                    if (append) {
                        setLoadMoreState("error");
                        setLoadMoreError(error);
                        setLoadMoreMessage(getPlaylistsErrorCopy(error).detail);
                    } else {
                        setStatus(error);
                    }

                    return;
                }

                const page = parsePlaylistsResponse(payload);

                if (!page) {
                    if (!mountedRef.current) {
                        return;
                    }

                    if (append) {
                        setLoadMoreState("error");
                        setLoadMoreError("error");
                        setLoadMoreMessage(
                            getPlaylistsErrorCopy("error").detail,
                        );
                    } else {
                        setStatus("error");
                    }

                    return;
                }

                if (!mountedRef.current) {
                    return;
                }

                const requestKey = cursor ?? INITIAL_REQUEST_KEY;
                const hasDuplicateNextCursor =
                    append &&
                    page.nextCursor !== null &&
                    (page.nextCursor === cursor ||
                        completedCursorsRef.current.has(page.nextCursor));

                if (append) {
                    setPlaylists((current) =>
                        appendPlaylists(current, page.items),
                    );
                    completedCursorsRef.current.add(requestKey);

                    if (hasDuplicateNextCursor) {
                        setNextCursor(null);
                        setLoadMoreState("error");
                        setLoadMoreError("error");
                        setLoadMoreMessage(DUPLICATE_CURSOR_MESSAGE);
                        return;
                    }

                    setNextCursor(page.nextCursor);
                    setLoadMoreState("idle");
                    setLoadMoreError(null);
                    setLoadMoreMessage(null);
                } else {
                    completedCursorsRef.current.clear();
                    completedCursorsRef.current.add(requestKey);
                    setPlaylists(appendPlaylists([], page.items));
                    setNextCursor(page.nextCursor);
                    setStatus(page.items.length > 0 ? "ready" : "empty");
                    setLoadMoreState("idle");
                    setLoadMoreError(null);
                    setLoadMoreMessage(null);
                }
            } catch (error) {
                if (!mountedRef.current || isAbortError(error)) {
                    return;
                }

                if (append) {
                    setLoadMoreState("error");
                    setLoadMoreError("error");
                    setLoadMoreMessage(getPlaylistsErrorCopy("error").detail);
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
        completedCursorsRef.current.clear();
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
        completedCursorsRef.current.clear();
        void loadPage(null, false);
    };

    const loadMore = () => {
        if (nextCursor !== null) {
            void loadPage(nextCursor, true);
        }
    };

    const hasPlaylists = playlists.length > 0;
    const selectedPlaylist = playlists.find(
        (playlist) =>
            playlist.spotifyId === selectedPlaylistId &&
            playlist.itemsAvailable,
    );

    return (
        <div className="space-y-5">
            {status === "loading" && hasPlaylists && (
                <p
                    className="text-sm text-[var(--muted-strong)]"
                    role="status"
                    aria-live="polite"
                >
                    Refreshing your playlists…
                </p>
            )}

            {status === "loading" && !hasPlaylists && <LoadingState />}

            {status === "empty" && <EmptyState />}

            {(status === "unauthenticated" ||
                status === "scope-required" ||
                status === "rate-limited" ||
                status === "unavailable" ||
                status === "error") &&
                !hasPlaylists && (
                    <ErrorState error={status} onRetry={retryInitialLoad} />
                )}

            {hasPlaylists && (
                <>
                    <div
                        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5"
                        role="list"
                        aria-label="Spotify playlists"
                    >
                        {playlists.map((playlist, index) => (
                            <div
                                className="min-w-0"
                                key={playlist.spotifyId}
                                role="listitem"
                            >
                                <PlaylistCard
                                    playlist={playlist}
                                    index={index}
                                    selected={
                                        selectedPlaylistId === playlist.spotifyId &&
                                        playlist.itemsAvailable
                                    }
                                    onSelect={() =>
                                        setSelectedPlaylistId((current) =>
                                            current === playlist.spotifyId
                                                ? null
                                                : playlist.spotifyId,
                                        )
                                    }
                                />
                            </div>
                        ))}
                    </div>

                    {selectedPlaylist && (
                        <div
                            className="flex flex-col gap-3 rounded-[1.15rem] border border-[rgba(124,245,188,0.28)] bg-[rgba(124,245,188,0.07)] p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <p
                                className="text-sm text-[var(--muted-strong)]"
                                role="status"
                                aria-live="polite"
                            >
                                <strong className="text-[var(--foreground)]">
                                    {selectedPlaylist.name}
                                </strong>{" "}
                                is ready for a lyric challenge.
                            </p>
                            <Link
                                className="inline-flex min-h-11 flex-none items-center justify-center rounded-full bg-[var(--accent)] px-5 text-sm font-bold text-[var(--accent-ink)] no-underline transition-transform hover:-translate-y-0.5"
                                href={createChallengeIntroUrl({
                                    kind: "playlist",
                                    spotifyId: selectedPlaylist.spotifyId,
                                    displayName: selectedPlaylist.name,
                                })}
                            >
                                Continue to setup
                            </Link>
                        </div>
                    )}

                    {(nextCursor !== null || loadMoreMessage) && (
                        <div className="flex flex-col items-center gap-3 pt-2">
                            {loadMoreMessage && (
                                <div
                                    className="flex flex-wrap items-center justify-center gap-3 text-center"
                                    role="alert"
                                >
                                    <p className="text-sm text-[var(--muted-strong)]">
                                        {loadMoreMessage}
                                    </p>
                                    {loadMoreError === "scope-required" && (
                                        <a
                                            className="text-sm font-semibold text-[var(--accent)] underline decoration-[var(--accent)] underline-offset-4"
                                            href={SPOTIFY_REAUTHORIZE_ROUTE}
                                        >
                                            Reconnect Spotify
                                        </a>
                                    )}
                                </div>
                            )}
                            {nextCursor !== null && (
                                <button
                                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--border-strong)] px-5 text-sm font-semibold text-[var(--muted-strong)] transition-colors hover:border-[var(--teal)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                                    type="button"
                                    onClick={loadMore}
                                    disabled={loadMoreState === "loading"}
                                    aria-busy={loadMoreState === "loading"}
                                >
                                    {loadMoreState === "loading"
                                        ? "Loading more playlists…"
                                        : loadMoreState === "error"
                                          ? "Try loading again"
                                          : "Load more playlists"}
                                </button>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
