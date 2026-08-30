/**
 * Small, provider-neutral seam around the official YouTube IFrame API.
 *
 * The module intentionally does not import the YouTube Data API, read any
 * credentials, or accept a provider URL. The caller supplies a validated
 * opaque video ID and a server-derived position from the server-owned
 * playback DTO.
 */

export const YOUTUBE_IFRAME_API_SRC = "https://www.youtube.com/iframe_api";
export const YOUTUBE_IFRAME_SCRIPT_ID = "fillthelyrics-youtube-iframe-api";
export const YOUTUBE_IFRAME_SCRIPT_TIMEOUT_MS = 8_000;
export const YOUTUBE_AUTOPLAY_VISIBILITY_THRESHOLD = 0.5;

/** Keep an accidental or malformed timestamp from reaching the player API. */
export const MAX_YOUTUBE_START_SECONDS = 24 * 60 * 60;

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

export type YouTubeIframeReadyEvent = Readonly<{
  target: YouTubeIframePlayerInstance;
}>;

export type YouTubeIframePlayerOptions = Readonly<{
  videoId: string;
  playerVars: Readonly<{
    controls: 1;
    rel: 0;
    playsinline: 1;
    modestbranding: 1;
  }>;
  events: Readonly<{
    onReady: (event: YouTubeIframeReadyEvent) => void;
    onError: (event: unknown) => void;
    onAutoplayBlocked: (event: unknown) => void;
  }>;
}>;

export type YouTubeIframePlayerInstance = Readonly<{
  destroy: () => void;
  playVideo: () => void | PromiseLike<void>;
  loadVideoById?: (
    options: Readonly<{ videoId: string; startSeconds: number }>,
  ) => void;
  cueVideoById?: (
    options: Readonly<{ videoId: string; startSeconds: number }>,
  ) => void;
}>;

/**
 * The small part of an IntersectionObserver entry needed by the autoplay
 * gate. Keeping this narrow makes the browser observer easy to replace in
 * tests without leaking provider or DOM details through the player seam.
 */
export type YouTubeIframeVisibilityEntry = Readonly<{
  intersectionRatio: number;
  isIntersecting?: boolean;
}>;

export type YouTubeIframeVisibilityObserver = Readonly<{
  observe: (element: HTMLElement) => void;
  disconnect: () => void;
}>;

export type YouTubeIframeVisibilityObserverFactory = (
  onVisibilityChange: (entry: YouTubeIframeVisibilityEntry) => void,
) => YouTubeIframeVisibilityObserver | null;

export type YouTubeIframeApi = Readonly<{
  Player: new (
    element: HTMLElement,
    options: YouTubeIframePlayerOptions,
  ) => YouTubeIframePlayerInstance;
}>;

export type YouTubeIframeWindow = Readonly<{
  YT?: YouTubeIframeApi;
  onYouTubeIframeAPIReady?: () => void;
}> & {
  onYouTubeIframeAPIReady?: () => void;
};

export type YouTubeIframeDocument = Pick<
  Document,
  "createElement" | "getElementById"
> &
  Readonly<{
    head: Pick<HTMLHeadElement, "appendChild">;
  }>;

export type YouTubeIframeApiLoadOptions = Readonly<{
  document?: YouTubeIframeDocument;
  window?: YouTubeIframeWindow;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export type YouTubeIframePlayerCreateOptions = Readonly<{
  container: HTMLElement;
  videoId: string;
  startAtMs: number;
  /** Accessible title applied to the generated iframe when provided. */
  title?: string;
  api?: YouTubeIframeApi;
  signal?: AbortSignal;
  loadApi?: (
    options?: YouTubeIframeApiLoadOptions,
  ) => Promise<YouTubeIframeApi>;
  /** Test seam for the browser visibility gate. */
  visibilityObserverFactory?: YouTubeIframeVisibilityObserverFactory;
  onAutoplayBlocked?: () => void;
  onError?: () => void;
}>;

export type YouTubeIframePlayerHandle = Readonly<{
  startSeconds: number;
  destroy: () => void;
}>;

export class YouTubeIframePlayerInputError extends Error {
  constructor() {
    super("YouTube playback input is invalid.");
    this.name = "YouTubeIframePlayerInputError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class YouTubeIframeApiError extends Error {
  constructor() {
    super("YouTube playback could not load.");
    this.name = "YouTubeIframeApiError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function getDefaultDocument(): YouTubeIframeDocument | undefined {
  return typeof document === "undefined"
    ? undefined
    : (document as unknown as YouTubeIframeDocument);
}

function getDefaultWindow(): YouTubeIframeWindow | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as YouTubeIframeWindow);
}

function isYouTubeIframeApi(value: unknown): value is YouTubeIframeApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "Player" in value &&
    typeof value.Player === "function"
  );
}

function createAbortError(): Error {
  const error = new Error("The playback request was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function isThenable(value: unknown): value is PromiseLike<void> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/**
 * Keep the threshold policy in one pure predicate so an injected observer
 * cannot accidentally bypass the visibility requirement.
 */
export function isYouTubeIframeVisibilitySufficient(
  entry: YouTubeIframeVisibilityEntry,
): boolean {
  return (
    typeof entry.intersectionRatio === "number" &&
    Number.isFinite(entry.intersectionRatio) &&
    entry.intersectionRatio > YOUTUBE_AUTOPLAY_VISIBILITY_THRESHOLD &&
    entry.isIntersecting !== false
  );
}

/**
 * Use the real browser observer in production. Environments without
 * IntersectionObserver keep the player fully manual rather than making an
 * unverified autoplay attempt.
 */
export const createYouTubeIframeVisibilityObserver: YouTubeIframeVisibilityObserverFactory = (
  onVisibilityChange,
) => {
  if (typeof IntersectionObserver === "undefined") {
    return null;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1];
      if (entry === undefined) {
        return;
      }

      onVisibilityChange({
        intersectionRatio: entry.intersectionRatio,
        isIntersecting: entry.isIntersecting,
      });
    },
    {
      threshold: [0, YOUTUBE_AUTOPLAY_VISIBILITY_THRESHOLD, 1],
    },
  );

  return {
    observe: (element) => observer.observe(element),
    disconnect: () => observer.disconnect(),
  };
};

/**
 * Convert the server-owned millisecond hint to a bounded IFrame API value.
 * Fractions of a second are preserved for a closer best-effort start, while
 * values outside the safe/non-negative range are rejected or capped.
 */
export function toBoundedYouTubeStartSeconds(
  startAtMs: unknown,
): number | null {
  if (
    typeof startAtMs !== "number" ||
    !Number.isSafeInteger(startAtMs) ||
    startAtMs < 0
  ) {
    return null;
  }

  return Math.min(MAX_YOUTUBE_START_SECONDS, startAtMs / 1_000);
}

/**
 * Script loading is shared per document and always has a finite timeout. A
 * failed load removes its in-flight entry so a later explicit retry can try
 * again; an aborted caller does not cancel another caller's shared load.
 */
const apiLoads = new WeakMap<object, Promise<YouTubeIframeApi>>();

function loadSharedYouTubeIframeApi(
  documentRef: YouTubeIframeDocument,
  windowRef: YouTubeIframeWindow,
  timeoutMs: number,
): Promise<YouTubeIframeApi> {
  const existing = apiLoads.get(documentRef);
  if (existing !== undefined) {
    return existing;
  }

  const existingScript = documentRef.getElementById(
    YOUTUBE_IFRAME_SCRIPT_ID,
  ) as HTMLScriptElement | null;

  if (
    existingScript !== null &&
    existingScript.getAttribute("src") !== null &&
    existingScript.getAttribute("src") !== YOUTUBE_IFRAME_API_SRC
  ) {
    return Promise.reject(new YouTubeIframeApiError());
  }

  const loadRef: { value?: Promise<YouTubeIframeApi> } = {};
  let settled = false;
  let failed = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const load = new Promise<YouTubeIframeApi>((resolve, reject) => {
    let script: HTMLScriptElement | null = null;
    let createdScript = false;
    const previousReady = windowRef.onYouTubeIframeAPIReady;

    const cleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      script?.removeEventListener("load", onLoad);
      script?.removeEventListener("error", onError);

      if (windowRef.onYouTubeIframeAPIReady === onReady) {
        windowRef.onYouTubeIframeAPIReady = previousReady;
      }
    };

    const fail = () => {
      if (settled) {
        return;
      }

      settled = true;
      failed = true;
      cleanup();
      if (
        loadRef.value !== undefined &&
        apiLoads.get(documentRef) === loadRef.value
      ) {
        apiLoads.delete(documentRef);
      }

      // A script that failed or timed out cannot become usable on a later
      // attempt. Remove only scripts created by this loader; host-owned
      // script elements remain untouched.
      if (createdScript) {
        try {
          script?.remove();
        } catch {
          // Optional DOM cleanup must not mask the stable loader error.
        }
      }

      reject(new YouTubeIframeApiError());
    };

    const finishIfReady = () => {
      const api = windowRef.YT;
      if (!isYouTubeIframeApi(api)) {
        return;
      }

      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(api);
    };

    const onReady = () => {
      // A host page may already have registered a callback. Its diagnostics
      // are deliberately ignored if they throw; provider details do not cross
      // this boundary.
      try {
        previousReady?.();
      } catch {
        // Keep the application callback deterministic.
      }
      finishIfReady();
    };

    const onLoad = () => finishIfReady();
    const onError = () => fail();

    windowRef.onYouTubeIframeAPIReady = onReady;
    script = existingScript;

    if (script === null) {
      script = documentRef.createElement("script");
      script.id = YOUTUBE_IFRAME_SCRIPT_ID;
      script.async = true;
      script.src = YOUTUBE_IFRAME_API_SRC;
      createdScript = true;
    }

    timeoutId = setTimeout(fail, timeoutMs);
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);

    if (createdScript) {
      documentRef.head.appendChild(script);
    } else {
      // A script inserted by a previous caller may have completed before this
      // listener was attached. Check the global once before waiting.
      finishIfReady();
    }
  });
  loadRef.value = load;

  // Promise executors run synchronously. If an injected script seam fails
  // synchronously, `fail` cannot see the map entry until after construction;
  // remove that stale rejected entry before returning so a retry is real.
  apiLoads.set(documentRef, load);
  if (failed && apiLoads.get(documentRef) === load) {
    apiLoads.delete(documentRef);
  }

  return load;
}

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function loadYouTubeIframeApi(
  options: YouTubeIframeApiLoadOptions = {},
): Promise<YouTubeIframeApi> {
  const documentRef = options.document ?? getDefaultDocument();
  const windowRef = options.window ?? getDefaultWindow();
  const timeoutMs = options.timeoutMs ?? YOUTUBE_IFRAME_SCRIPT_TIMEOUT_MS;

  if (
    documentRef === undefined ||
    windowRef === undefined ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return Promise.reject(new YouTubeIframeApiError());
  }

  throwIfAborted(options.signal);

  if (isYouTubeIframeApi(windowRef.YT)) {
    return Promise.resolve(windowRef.YT);
  }

  return awaitWithAbort(
    loadSharedYouTubeIframeApi(documentRef, windowRef, timeoutMs),
    options.signal,
  );
}

function attemptPlay(
  player: YouTubeIframePlayerInstance,
  onAutoplayBlocked: () => void,
): void {
  try {
    const result = player.playVideo();
    if (isThenable(result)) {
      void result.then(undefined, () => onAutoplayBlocked());
    }
  } catch {
    onAutoplayBlocked();
  }
}

function configureGeneratedIframe(
  container: HTMLElement,
  title: string | undefined,
): void {
  // The IFrame API writes its iframe into the supplied container. Keep this
  // defensive because test seams and provider failures may not create one.
  const querySelector = (
    container as HTMLElement & {
      querySelector?: (selector: string) => Element | null;
    }
  ).querySelector;

  if (typeof querySelector !== "function") {
    return;
  }

  let iframe: HTMLIFrameElement | null;
  try {
    iframe = querySelector.call(container, "iframe") as HTMLIFrameElement | null;
  } catch {
    return;
  }

  if (iframe === null) {
    return;
  }

  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.minWidth = "200px";
  iframe.style.minHeight = "200px";
  iframe.setAttribute("width", "100%");
  iframe.setAttribute("height", "100%");

  if (typeof title === "string" && title.trim().length > 0) {
    iframe.title = title;
  }
}

/**
 * Create one visible, controllable IFrame API player. Positioning happens
 * once from the API's ready callback; the scripted play attempt waits until
 * the injected/browser visibility observer reports at least half of the
 * player in the viewport. `destroy` is safe to call repeatedly, which lets
 * React unmount and retry paths share cleanup.
 */
export async function createYouTubeIframePlayer(
  options: YouTubeIframePlayerCreateOptions,
): Promise<YouTubeIframePlayerHandle> {
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.container !== "object" ||
    options.container === null ||
    typeof options.videoId !== "string" ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(options.videoId)
  ) {
    throw new YouTubeIframePlayerInputError();
  }

  const startSeconds = toBoundedYouTubeStartSeconds(options.startAtMs);
  if (startSeconds === null) {
    throw new YouTubeIframePlayerInputError();
  }

  throwIfAborted(options.signal);

  const api =
    options.api ??
    (await (options.loadApi ?? loadYouTubeIframeApi)({
      signal: options.signal,
    }));
  throwIfAborted(options.signal);

  let player: YouTubeIframePlayerInstance | null = null;
  let visibilityObserver: YouTubeIframeVisibilityObserver | null = null;
  let destroyed = false;
  let positioned = false;
  let ready = false;
  let visibleEnough = false;
  let playAttempted = false;
  let readyBeforeAssignment = false;
  let errorBeforeAssignment = false;

  const disconnectVisibilityObserver = () => {
    try {
      visibilityObserver?.disconnect();
    } catch {
      // Observer cleanup is best effort and must not mask player cleanup.
    }
    visibilityObserver = null;
  };

  const notifyAutoplayBlocked = () => {
    // A provider block is terminal for this scripted attempt. Manual controls
    // remain available, but visibility changes must not retry it implicitly.
    playAttempted = true;
    if (!destroyed) {
      options.onAutoplayBlocked?.();
    }
  };

  const notifyError = () => {
    playAttempted = true;
    if (player === null) {
      errorBeforeAssignment = true;
    }

    if (!destroyed) {
      options.onError?.();
    }
  };

  const attemptPlayWhenVisible = () => {
    if (
      destroyed ||
      player === null ||
      !ready ||
      !positioned ||
      !visibleEnough ||
      playAttempted
    ) {
      return;
    }

    playAttempted = true;
    attemptPlay(player, notifyAutoplayBlocked);
  };

  const handleVisibilityChange = (entry: YouTubeIframeVisibilityEntry) => {
    visibleEnough = isYouTubeIframeVisibilitySufficient(entry);
    attemptPlayWhenVisible();
  };

  const handleReady = () => {
    if (destroyed) {
      return;
    }

    if (player === null) {
      readyBeforeAssignment = true;
      return;
    }

    if (ready) {
      return;
    }
    ready = true;

    try {
      if (player.loadVideoById !== undefined) {
        player.loadVideoById({
          videoId: options.videoId,
          startSeconds,
        });
      } else if (player.cueVideoById !== undefined) {
        player.cueVideoById({
          videoId: options.videoId,
          startSeconds,
        });
      } else {
        notifyError();
        return;
      }
      positioned = true;
      attemptPlayWhenVisible();
    } catch {
      notifyError();
    }
  };

  try {
    const createObserver =
      options.visibilityObserverFactory ??
      createYouTubeIframeVisibilityObserver;
    visibilityObserver = createObserver(handleVisibilityChange);
    visibilityObserver?.observe(options.container);
  } catch {
    // A missing or broken observer leaves the visible player fully manual.
    disconnectVisibilityObserver();
  }

  try {
    player = new api.Player(options.container, {
      videoId: options.videoId,
      playerVars: {
        controls: 1,
        rel: 0,
        playsinline: 1,
        modestbranding: 1,
      },
      events: {
        onReady: handleReady,
        onError: notifyError,
        onAutoplayBlocked: notifyAutoplayBlocked,
      },
    });
  } catch {
    disconnectVisibilityObserver();
    throw new YouTubeIframeApiError();
  }

  if (errorBeforeAssignment) {
    // The API may synchronously emit an error while its constructor is still
    // assigning the instance. Destroy it now; the caller cannot yet have a
    // handle to perform this cleanup.
    destroyed = true;
    try {
      player?.destroy();
    } catch {
      // Best-effort provider cleanup.
    }
    disconnectVisibilityObserver();
    player = null;
  } else if (readyBeforeAssignment) {
    handleReady();
  }

  configureGeneratedIframe(options.container, options.title);

  const handle: YouTubeIframePlayerHandle = {
    startSeconds,
    destroy: () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      disconnectVisibilityObserver();
      try {
        player?.destroy();
      } catch {
        // Provider cleanup must not turn an optional player into a page error.
      }
      player = null;
    },
  };

  return Object.freeze(handle);
}
