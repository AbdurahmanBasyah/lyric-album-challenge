import { describe, expect, it, vi } from "vitest";

import {
  createYouTubeIframePlayer,
  isYouTubeIframeVisibilitySufficient,
  loadYouTubeIframeApi,
  MAX_YOUTUBE_START_SECONDS,
  toBoundedYouTubeStartSeconds,
  YOUTUBE_IFRAME_API_SRC,
  YOUTUBE_IFRAME_SCRIPT_ID,
  type YouTubeIframeApi,
  type YouTubeIframeDocument,
  type YouTubeIframePlayerInstance,
  type YouTubeIframePlayerOptions,
  type YouTubeIframeVisibilityObserverFactory,
  type YouTubeIframeWindow,
} from "./youtube-iframe-player";

const VIDEO_ID = "dQw4w9WgXcQ";

function createFakePlayerHarness(options: {
  playVideo?: () => void | PromiseLike<void>;
  loadVideoById?: YouTubeIframePlayerInstance["loadVideoById"];
} = {}) {
  let playerOptions: YouTubeIframePlayerOptions | undefined;
  const player: YouTubeIframePlayerInstance = {
    destroy: vi.fn(),
    playVideo: vi.fn(options.playVideo ?? (() => undefined)),
    loadVideoById: options.loadVideoById ?? vi.fn(),
  };
  const Player = vi.fn(function (
    _container: HTMLElement,
    value: YouTubeIframePlayerOptions,
  ) {
    playerOptions = value;
    return player;
  }) as unknown as YouTubeIframeApi["Player"];

  return {
    api: { Player } as YouTubeIframeApi,
    player,
    getPlayerOptions: () => playerOptions,
  };
}

type FakeScript = HTMLScriptElement & {
  emit: (event: "load" | "error") => void;
  remove: ReturnType<typeof vi.fn>;
};

function createFakeScript(): FakeScript {
  const listeners = new Map<string, Set<() => void>>();
  const script = {
    id: "",
    async: false,
    src: "",
    addEventListener: (event: string, listener: EventListenerOrEventListenerObject) => {
      const callbacks = listeners.get(event) ?? new Set<() => void>();
      callbacks.add(
        typeof listener === "function"
          ? (listener as () => void)
          : () => listener.handleEvent(new Event(event)),
      );
      listeners.set(event, callbacks);
    },
    removeEventListener: (event: string, listener: EventListenerOrEventListenerObject) => {
      const callbacks = listeners.get(event);
      if (callbacks === undefined) return;
      callbacks.delete(
        typeof listener === "function"
          ? (listener as () => void)
          : () => listener.handleEvent(new Event(event)),
      );
    },
    getAttribute: (name: string) => (name === "src" ? script.src : null),
    remove: vi.fn(),
    emit: (event: "load" | "error") => {
      for (const callback of listeners.get(event) ?? []) callback();
    },
  } as unknown as FakeScript;

  return script;
}

function createFakeDocument(script: FakeScript | null = null) {
  const created = script ?? createFakeScript();
  const documentRef = {
    createElement: vi.fn(() => created),
    getElementById: vi.fn((id: string) =>
      id === YOUTUBE_IFRAME_SCRIPT_ID && script !== null ? created : null,
    ),
    head: { appendChild: vi.fn() },
  } as unknown as YouTubeIframeDocument;

  return { documentRef, script: created };
}

function createFakeWindow(): YouTubeIframeWindow {
  return { YT: undefined, onYouTubeIframeAPIReady: undefined };
}

function createFakeVisibilityObserverHarness() {
  let onVisibilityChange:
    | Parameters<YouTubeIframeVisibilityObserverFactory>[0]
    | undefined;
  const observer = {
    observe: vi.fn(),
    disconnect: vi.fn(),
  };

  return {
    factory: vi.fn((callback: Parameters<YouTubeIframeVisibilityObserverFactory>[0]) => {
      onVisibilityChange = callback;
      return observer;
    }) as YouTubeIframeVisibilityObserverFactory,
    observer,
    emit: (intersectionRatio: number, isIntersecting = true) => {
      onVisibilityChange?.({ intersectionRatio, isIntersecting });
    },
  };
}

describe("bounded YouTube IFrame playback seam", () => {
  it("requires more than half of the player to intersect the viewport", async () => {
    const harness = createFakePlayerHarness();
    const visibility = createFakeVisibilityObserverHarness();
    const handle = await createYouTubeIframePlayer({
      container: {} as HTMLElement,
      videoId: VIDEO_ID,
      startAtMs: 0,
      api: harness.api,
      visibilityObserverFactory: visibility.factory,
    });
    const playerOptions = harness.getPlayerOptions();

    playerOptions?.events.onReady({ target: harness.player });
    visibility.emit(0.49);
    expect(harness.player.playVideo).not.toHaveBeenCalled();

    visibility.emit(0.5);
    expect(harness.player.playVideo).not.toHaveBeenCalled();

    visibility.emit(0.51);
    expect(harness.player.playVideo).toHaveBeenCalledTimes(1);
    visibility.emit(1);
    expect(harness.player.playVideo).toHaveBeenCalledTimes(1);

    handle.destroy();
    expect(visibility.observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-intersecting entry even when its ratio is high", () => {
    expect(
      isYouTubeIframeVisibilitySufficient({
        intersectionRatio: 0.75,
        isIntersecting: false,
      }),
    ).toBe(false);
  });

  it("converts only non-negative safe millisecond positions to bounded seconds", () => {
    expect(toBoundedYouTubeStartSeconds(0)).toBe(0);
    expect(toBoundedYouTubeStartSeconds(1_500)).toBe(1.5);
    expect(toBoundedYouTubeStartSeconds(8_500)).toBe(8.5);
    expect(toBoundedYouTubeStartSeconds(Number.MAX_SAFE_INTEGER)).toBe(
      MAX_YOUTUBE_START_SECONDS,
    );

    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "8_500"]) {
      expect(toBoundedYouTubeStartSeconds(value)).toBeNull();
    }
  });

  it("loads the official script once and resolves through its ready callback", async () => {
    const { documentRef, script } = createFakeDocument();
    const windowRef = createFakeWindow();
    const api = createFakePlayerHarness().api;

    const first = loadYouTubeIframeApi({ document: documentRef, window: windowRef });
    const second = loadYouTubeIframeApi({ document: documentRef, window: windowRef });

    expect(documentRef.head.appendChild).toHaveBeenCalledTimes(1);
    expect(script.id).toBe(YOUTUBE_IFRAME_SCRIPT_ID);
    expect(script.src).toBe(YOUTUBE_IFRAME_API_SRC);

    (windowRef as { YT?: YouTubeIframeApi }).YT = api;
    windowRef.onYouTubeIframeAPIReady?.();

    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it("maps script errors and finite timeouts to a safe retryable failure", async () => {
    const failed = createFakeDocument();
    const failedWindow = createFakeWindow();
    const failedPromise = loadYouTubeIframeApi({
      document: failed.documentRef,
      window: failedWindow,
      timeoutMs: 100,
    });
    failed.script.emit("error");
    await expect(failedPromise).rejects.toMatchObject({
      name: "YouTubeIframeApiError",
    });

    const timedOut = createFakeDocument();
    await expect(
      loadYouTubeIframeApi({
        document: timedOut.documentRef,
        window: createFakeWindow(),
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ name: "YouTubeIframeApiError" });
  });

  it("removes its failed script and allows a later explicit retry", async () => {
    const { documentRef, script } = createFakeDocument();
    const windowRef = createFakeWindow();
    const first = loadYouTubeIframeApi({
      document: documentRef,
      window: windowRef,
      timeoutMs: 100,
    });
    script.emit("error");
    await expect(first).rejects.toMatchObject({ name: "YouTubeIframeApiError" });
    expect(script.remove).toHaveBeenCalledTimes(1);

    const second = loadYouTubeIframeApi({
      document: documentRef,
      window: windowRef,
      timeoutMs: 100,
    });
    expect(documentRef.head.appendChild).toHaveBeenCalledTimes(2);
    (windowRef as { YT?: YouTubeIframeApi }).YT = createFakePlayerHarness().api;
    windowRef.onYouTubeIframeAPIReady?.();
    await expect(second).resolves.toBe(windowRef.YT);
  });

  it("positions once and makes one visibility-gated best-effort play attempt", async () => {
    const harness = createFakePlayerHarness();
    const visibility = createFakeVisibilityObserverHarness();
    const handle = await createYouTubeIframePlayer({
      container: {} as HTMLElement,
      videoId: VIDEO_ID,
      startAtMs: 8_500,
      api: harness.api,
      visibilityObserverFactory: visibility.factory,
    });
    const playerOptions = harness.getPlayerOptions();

    expect(playerOptions).toBeDefined();
    playerOptions?.events.onReady({ target: harness.player });
    playerOptions?.events.onReady({ target: harness.player });

    expect(harness.player.loadVideoById).toHaveBeenCalledTimes(1);
    expect(harness.player.loadVideoById).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      startSeconds: 8.5,
    });
    expect(harness.player.playVideo).not.toHaveBeenCalled();
    visibility.emit(0.51);
    expect(harness.player.playVideo).toHaveBeenCalledTimes(1);
    expect(playerOptions?.playerVars).toEqual({
      controls: 1,
      rel: 0,
      playsinline: 1,
      modestbranding: 1,
    });
    expect(JSON.stringify(playerOptions)).not.toContain("endSeconds");
    expect(JSON.stringify(playerOptions)).not.toContain("autoplay");

    handle.destroy();
    handle.destroy();
    expect(harness.player.destroy).toHaveBeenCalledTimes(1);
  });

  it("sizes and titles an iframe created by the API", async () => {
    const iframe = {
      style: {
        width: "",
        height: "",
        minWidth: "",
        minHeight: "",
      },
      setAttribute: vi.fn(),
      title: "",
    } as unknown as HTMLIFrameElement;
    const container = {
      querySelector: vi.fn(() => iframe),
    } as unknown as HTMLElement;
    const harness = createFakePlayerHarness();

    const handle = await createYouTubeIframePlayer({
      container,
      videoId: VIDEO_ID,
      startAtMs: 8_500,
      title: "YouTube player for Example Track",
      api: harness.api,
    });

    expect(iframe.style.width).toBe("100%");
    expect(iframe.style.height).toBe("100%");
    expect(iframe.style.minWidth).toBe("200px");
    expect(iframe.style.minHeight).toBe("200px");
    expect(iframe.title).toBe("YouTube player for Example Track");
    expect(iframe.setAttribute).toHaveBeenCalledWith("width", "100%");
    expect(iframe.setAttribute).toHaveBeenCalledWith("height", "100%");
    handle.destroy();
  });

  it("reports autoplay policy blocks and rejected play promises without destroying controls", async () => {
    const onAutoplayBlocked = vi.fn();
    const rejectedPlay = createFakePlayerHarness({
      playVideo: () => Promise.reject(new Error("blocked")),
    });
    const visibility = createFakeVisibilityObserverHarness();
    const handle = await createYouTubeIframePlayer({
      container: {} as HTMLElement,
      videoId: VIDEO_ID,
      startAtMs: 0,
      api: rejectedPlay.api,
      visibilityObserverFactory: visibility.factory,
      onAutoplayBlocked,
    });
    const playerOptions = rejectedPlay.getPlayerOptions();

    playerOptions?.events.onReady({ target: rejectedPlay.player });
    visibility.emit(0.51);
    playerOptions?.events.onAutoplayBlocked({ reason: "browser-policy" });
    await Promise.resolve();

    expect(onAutoplayBlocked).toHaveBeenCalledTimes(2);
    expect(rejectedPlay.player.destroy).not.toHaveBeenCalled();
    handle.destroy();
  });

  it("reports player errors safely and supports cue fallback when load is absent", async () => {
    const onError = vi.fn();
    const cueVideoById = vi.fn();
    const cuePlayer: YouTubeIframePlayerInstance = {
      destroy: vi.fn(),
      playVideo: vi.fn(),
      cueVideoById,
    };
    let playerOptions: YouTubeIframePlayerOptions | undefined;
    const cueApi: YouTubeIframeApi = {
      Player: vi.fn(function (
        _container: HTMLElement,
        value: YouTubeIframePlayerOptions,
      ) {
        playerOptions = value;
        return cuePlayer;
      }) as unknown as YouTubeIframeApi["Player"],
    };
    const handle = await createYouTubeIframePlayer({
      container: {} as HTMLElement,
      videoId: VIDEO_ID,
      startAtMs: 2_000,
      api: cueApi,
      onError,
    });
    playerOptions?.events.onReady({ target: cuePlayer });
    playerOptions?.events.onError({ code: 150 });

    expect(cueVideoById).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      startSeconds: 2,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it("destroys a player that errors before the async handle is assigned", async () => {
    const onError = vi.fn();
    const player: YouTubeIframePlayerInstance = {
      destroy: vi.fn(),
      playVideo: vi.fn(),
      loadVideoById: vi.fn(),
    };
    const Player = vi.fn(function (
      _container: HTMLElement,
      options: YouTubeIframePlayerOptions,
    ) {
      options.events.onError({ code: 150 });
      return player;
    }) as unknown as YouTubeIframeApi["Player"];

    const handle = await createYouTubeIframePlayer({
      container: {} as HTMLElement,
      videoId: VIDEO_ID,
      startAtMs: 0,
      api: { Player },
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(player.destroy).toHaveBeenCalledTimes(1);
    handle.destroy();
    expect(player.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects provider URLs, malformed IDs, and malformed positions before API work", async () => {
    const harness = createFakePlayerHarness();

    await expect(
      createYouTubeIframePlayer({
        container: {} as HTMLElement,
        videoId: "https://youtube.com/watch?v=dQw4w9WgXcQ",
        startAtMs: 0,
        api: harness.api,
      }),
    ).rejects.toMatchObject({ name: "YouTubeIframePlayerInputError" });
    await expect(
      createYouTubeIframePlayer({
        container: {} as HTMLElement,
        videoId: VIDEO_ID,
        startAtMs: -1,
        api: harness.api,
      }),
    ).rejects.toMatchObject({ name: "YouTubeIframePlayerInputError" });
    expect(harness.api.Player).not.toHaveBeenCalled();
  });
});
