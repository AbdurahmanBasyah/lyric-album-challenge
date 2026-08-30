"use client";

import { useEffect, useRef, useState } from "react";

const SPOTIFY_AUTH_ROUTE = "/api/auth/spotify";

const CALLBACK_MESSAGES = {
    success: "Spotify connection completed.",
    error: "We couldn't connect to Spotify. Please try again.",
} as const;

type AuthState = "loading" | "anonymous" | "authenticated" | "error";

export type CallbackFeedback = Readonly<{
    kind: "success" | "error";
    message: string;
    cleanedSearch: string;
}>;

/**
 * Parse only the local callback marker and remove its generic reason from the
 * URL. Provider errors are intentionally never rendered or returned here.
 */
export function readCallbackFeedback(search: string): CallbackFeedback | null {
    const params = new URLSearchParams(search);
    const marker = params.get("auth");

    if (marker !== "success" && marker !== "error") {
        return null;
    }

    params.delete("auth");
    params.delete("reason");

    const remainingSearch = params.toString();

    return {
        kind: marker,
        message: CALLBACK_MESSAGES[marker],
        cleanedSearch: remainingSearch ? `?${remainingSearch}` : "",
    };
}

/**
 * Validate the intentionally small public session response without copying
 * any other provider fields into client state.
 */
export function parseSessionState(
    payload: unknown,
): Extract<AuthState, "anonymous" | "authenticated"> | null {
    if (typeof payload !== "object" || payload === null) {
        return null;
    }

    const authenticated = (payload as { authenticated?: unknown }).authenticated;

    if (authenticated === true) {
        return "authenticated";
    }

    if (authenticated === false) {
        return "anonymous";
    }

    return null;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
}

function SpotifyIcon() {
    return (
        <span className="spotify-cta-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm4.13 13.04a.68.68 0 0 1-.94.23c-2.58-1.58-5.83-1.94-9.66-1.06a.68.68 0 1 1-.3-1.32c4.19-.96 7.78-.55 10.67 1.22.32.2.42.62.23.93Zm1.25-2.78a.85.85 0 0 1-1.17.28c-2.95-1.82-7.45-2.34-10.94-1.28a.85.85 0 1 1-.49-1.63c3.99-1.21 8.95-.63 12.32 1.44.4.24.52.76.28 1.19Zm.1-2.9C13.94 8.2 7.67 8.03 4.05 9.13a1.02 1.02 0 0 1-.59-1.95c4.16-1.26 11.07-1 15.22 1.47a1.02 1.02 0 0 1-1.2 1.71Z" />
            </svg>
        </span>
    );
}

export function SpotifyAuthPanel() {
    const [authState, setAuthState] = useState<AuthState>("loading");
    const [feedback, setFeedback] = useState<string | null>(null);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const mountedRef = useRef(true);
    const logoutControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        const controller = new AbortController();
        const callback = readCallbackFeedback(window.location.search);

        if (callback) {
            window.history.replaceState(
                window.history.state,
                "",
                `${window.location.pathname}${callback.cleanedSearch}${window.location.hash}`,
            );
            queueMicrotask(() => {
                if (mountedRef.current) {
                    setFeedback(callback.message);
                }
            });
        }

        const loadSession = async () => {
            try {
                const response = await fetch("/api/auth/session", {
                    method: "GET",
                    credentials: "same-origin",
                    headers: { Accept: "application/json" },
                    cache: "no-store",
                    signal: controller.signal,
                });

                if (!response.ok) {
                    throw new Error("Session request failed");
                }

                const sessionState = parseSessionState(await response.json());

                if (!sessionState) {
                    throw new Error("Invalid session response");
                }

                if (mountedRef.current) {
                    setAuthState(sessionState);
                }
            } catch (error) {
                if (!mountedRef.current || isAbortError(error)) {
                    return;
                }

                setAuthState("error");
            }
        };

        void loadSession();

        return () => {
            mountedRef.current = false;
            controller.abort();
            logoutControllerRef.current?.abort();
        };
    }, []);

    const handleLogout = async () => {
        if (isLoggingOut) {
            return;
        }

        const controller = new AbortController();
        logoutControllerRef.current = controller;
        setIsLoggingOut(true);
        setFeedback(null);

        try {
            const response = await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error("Logout request failed");
            }

            const sessionState = parseSessionState(await response.json());

            if (sessionState !== "anonymous") {
                throw new Error("Invalid logout response");
            }

            if (mountedRef.current) {
                setAuthState("anonymous");
                setFeedback("You've been signed out.");
            }
        } catch (error) {
            if (!mountedRef.current || isAbortError(error)) {
                return;
            }

            setFeedback("We couldn't sign you out. Please try again.");
        } finally {
            if (logoutControllerRef.current === controller) {
                logoutControllerRef.current = null;
            }

            if (mountedRef.current) {
                setIsLoggingOut(false);
            }
        }
    };

    const statusMessage =
        authState === "loading"
            ? "Checking your Spotify connection."
            : authState === "error"
              ? "We couldn't check your Spotify connection. Please try again."
              : feedback ??
                (authState === "authenticated"
                    ? "Spotify connected. Your saved albums and playlists are ready."
                    : "Connect your saved library to begin.");

    return (
        <div
            className="hero-actions"
            aria-busy={authState === "loading" || isLoggingOut}
        >
            {authState === "loading" && (
                <button
                    className="spotify-cta"
                    type="button"
                    disabled
                    aria-disabled="true"
                    aria-describedby="spotify-cta-status"
                >
                    <SpotifyIcon />
                    <span>Checking Spotify connection</span>
                </button>
            )}

            {(authState === "anonymous" || authState === "error") && (
                <a
                    className="spotify-cta !cursor-pointer no-underline"
                    href={SPOTIFY_AUTH_ROUTE}
                    aria-describedby="spotify-cta-status"
                >
                    <SpotifyIcon />
                    <span>Continue with Spotify</span>
                </a>
            )}

            {authState === "authenticated" && (
                <>
                    <a
                        className="spotify-cta !cursor-pointer no-underline"
                        href="/albums"
                        aria-describedby="spotify-cta-status"
                    >
                        <span>Choose a saved album or playlist</span>
                    </a>
                    <button
                        className="spotify-logout inline-flex min-h-[3.65rem] w-full items-center justify-center rounded-[1rem] border border-[var(--border-strong)] bg-transparent px-[1.15rem] py-[0.8rem] font-[inherit] text-[0.93rem] font-semibold text-[var(--muted-strong)] transition-colors hover:border-[var(--teal)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                        type="button"
                        onClick={() => void handleLogout()}
                        disabled={isLoggingOut}
                        aria-describedby="spotify-cta-status"
                        aria-busy={isLoggingOut}
                    >
                        <span>{isLoggingOut ? "Signing out" : "Sign out of Spotify"}</span>
                    </button>
                </>
            )}

            <p
                id="spotify-cta-status"
                className="cta-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
            >
                {statusMessage}
            </p>
        </div>
    );
}
