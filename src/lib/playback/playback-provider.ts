/**
 * Provider-neutral playback boundary.
 *
 * Playback is deliberately optional.  A caller may use the same result
 * contract for a Spotify adapter or for a future provider, but provider
 * credentials, URLs, and response bodies must remain inside that adapter.
 * The current Spotify implementation is policy-blocked, so the default
 * provider below never attempts a network request.
 */

export const PLAYBACK_LEAD_TIME_MS = 1_500;

export type PlaybackRequest = Readonly<{
  /**
   * Server-resolved track reference.  This is not a value supplied directly
   * by the browser and must not be copied into a client response.
   */
  trackId: string;
  windowStartTimestampMs: number;
}>;

export type PlaybackStartedResult = Readonly<{
  status: "started";
  startAtMs: number;
}>;

export type PlaybackFailureStatus =
  | "unsupported"
  | "not-premium"
  | "no-device"
  | "autoplay-blocked"
  | "auth-required"
  | "rate-limited"
  | "unavailable";

export type PlaybackFailureResult = Readonly<{
  status: PlaybackFailureStatus;
}>;

export type PlaybackResult = PlaybackStartedResult | PlaybackFailureResult;

export type PlaybackCapability = Readonly<{
  supported: boolean;
  /** A stable explanation category, never provider response text. */
  status: PlaybackFailureStatus;
}>;

export interface PlaybackProvider {
  readonly capability: PlaybackCapability;
  start(request: PlaybackRequest): Promise<PlaybackResult>;
}

export class PlaybackInputError extends Error {
  constructor() {
    super("Playback request input is invalid.");
    this.name = "PlaybackInputError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Calculates the optional playback position for a revealed lyric window.
 * The 1.5-second lead is a reward hint only; it is never used by gameplay or
 * scoring.  Validation belongs here so every future provider shares the same
 * non-negative, integer position contract.
 */
export function calculatePlaybackStartAtMs(
  windowStartTimestampMs: number,
): number {
  if (
    !Number.isSafeInteger(windowStartTimestampMs) ||
    windowStartTimestampMs < 0
  ) {
    throw new PlaybackInputError();
  }

  return Math.max(0, windowStartTimestampMs - PLAYBACK_LEAD_TIME_MS);
}

/**
 * The policy-gated default adapter.  It is intentionally stateless and has no
 * provider dependency, so invoking it cannot send a track, timestamp, token,
 * or request body anywhere.  A live adapter must not replace this default
 * without an explicit policy and authorization review.
 */
class UnsupportedPlaybackProvider implements PlaybackProvider {
  readonly capability: PlaybackCapability = Object.freeze({
    supported: false,
    status: "unsupported",
  });

  async start(request: PlaybackRequest): Promise<PlaybackResult> {
    // Keep the signature provider-compatible while deliberately discarding
    // all server-owned target data in the disabled mode.
    void request;
    return { status: "unsupported" };
  }
}

export function createUnsupportedPlaybackProvider(): PlaybackProvider {
  return new UnsupportedPlaybackProvider();
}

/** Default provider used while synchronized playback is policy-blocked. */
export const unsupportedPlaybackProvider: PlaybackProvider =
  createUnsupportedPlaybackProvider();
