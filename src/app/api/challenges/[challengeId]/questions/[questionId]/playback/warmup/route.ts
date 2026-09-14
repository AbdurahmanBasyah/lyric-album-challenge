import { NextResponse } from "next/server";

import {
  applySessionRefresh,
  createErrorResponse,
  createResolver,
  readAnonymousPublicChallenge,
  readAuthentication,
  readQuestion,
  readRouteParams,
  validatePlaybackBody,
  type PlaybackRouteDependencies,
} from "../route";
import {
  youtubeWarmupCache,
  type YouTubeWarmupCache,
} from "../../../../../../../../lib/playback/youtube-warmup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Warmup has the same bounded empty-body contract as terminal playback. */
export const MAX_WARMUP_REQUEST_BYTES = 4 * 1024;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

type WarmupRouteParams = Readonly<{
  challengeId: string;
  questionId: string;
}>;

function warmupAcceptedResponse(): NextResponse {
  return NextResponse.json(
    {
      warmup: {
        provider: "youtube" as const,
        status: "accepted" as const,
      },
    },
    { status: 202, headers: NO_STORE_HEADERS },
  );
}

function handleWarmup(
  params: WarmupRouteParams,
  dependencies: PlaybackRouteDependencies,
  apiKey: unknown,
): NextResponse {
  const found = readQuestion(params);

  if (found === null) {
    return createErrorResponse("CHALLENGE_NOT_FOUND");
  }

  if (found.question.status !== "active") {
    return createErrorResponse("QUESTION_NOT_ACTIVE");
  }

  const warmup: YouTubeWarmupCache = dependencies.warmup ?? youtubeWarmupCache;
  let resolver: ReturnType<typeof createResolver> | undefined;

  try {
    resolver = createResolver(dependencies, apiKey);
  } catch {
    // A provider configuration failure is optional work. The acknowledgement
    // remains safe and the cache records a reduced unavailable result.
  }

  try {
    const work = warmup.resolve(
      params.challengeId,
      params.questionId,
      found.challenge.expiresAt,
      async () => {
        if (resolver === undefined) {
          throw new Error("Playback resolver unavailable.");
        }

        return resolver.resolveTrack(found.question.track);
      },
    );

    // Warmup is deliberately detached from the response. The service already
    // reduces provider failures, and this final catch guards the route against
    // future loader/cache implementation errors producing unhandled rejections.
    void work.catch(() => undefined);
  } catch {
    // A malformed/expired server state must not turn an otherwise valid
    // acknowledgement into a provider diagnostic.
  }

  return warmupAcceptedResponse();
}

export function createPlaybackWarmupPostHandler(
  dependencies: PlaybackRouteDependencies = {},
): (
  request: Request,
  context: { params: Promise<{ challengeId: string; questionId: string }> },
) => Promise<NextResponse> {
  return async (
    request: Request,
    context: { params: Promise<{ challengeId: string; questionId: string }> },
  ): Promise<NextResponse> => {
    try {
      await validatePlaybackBody(request);
    } catch {
      return createErrorResponse("INVALID_INPUT");
    }

    let params = null as ReturnType<typeof readRouteParams>;

    try {
      params = readRouteParams(await context.params);
    } catch {
      params = null;
    }

    if (params === null) {
      return createErrorResponse("CHALLENGE_NOT_FOUND");
    }

    const publicChallenge = readAnonymousPublicChallenge(params.challengeId);

    if (publicChallenge !== null) {
      return handleWarmup(params, dependencies, undefined);
    }

    const authentication = await readAuthentication(dependencies);

    if (authentication instanceof NextResponse) {
      return authentication;
    }

    let response: NextResponse;

    try {
      response = handleWarmup(
        params,
        dependencies,
        authentication.environment.YOUTUBE_API_KEY ?? null,
      );
    } catch {
      response = createErrorResponse("CHALLENGE_NOT_FOUND");
    }

    return applySessionRefresh(response, authentication);
  };
}

export const POST = createPlaybackWarmupPostHandler();
