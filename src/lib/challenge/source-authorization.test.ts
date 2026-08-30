import { describe, expect, it, vi } from "vitest";

import {
  SpotifyLibraryContainsError,
  type SpotifyLibraryItemKind,
} from "../spotify/library-contains";
import {
  SourceAuthorizationError,
  authorizeChallengeSource,
  type SourceMembershipChecker,
} from "./source-authorization";

async function rejectedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to reject.");
}

function membershipChecker(
  result: boolean | Error,
): SourceMembershipChecker {
  return vi.fn(async () => {
    if (result instanceof Error) {
      throw result;
    }

    return result;
  });
}

describe("challenge source authorization", () => {
  it("authorizes and normalizes a saved album without trusting untrimmed display input", async () => {
    const source = {
      kind: "album" as const,
      spotifyId: " album-1 ",
      displayName: " Selected Album ",
    };
    const sourceBefore = JSON.stringify(source);
    const checker = membershipChecker(true);

    const authorized = await authorizeChallengeSource(source, " access-token ", {
      checkLibraryContains: checker,
    });

    expect(authorized).toEqual({
      kind: "album",
      spotifyId: "album-1",
      name: "Selected Album",
    });
    expect(Object.isFrozen(authorized)).toBe(true);
    expect(checker).toHaveBeenCalledTimes(1);
    expect(checker).toHaveBeenCalledWith("access-token", "album", "album-1");
    expect(JSON.stringify(source)).toBe(sourceBefore);
  });

  it("authorizes a playlist with an optional presentation name but omits it from the trusted source", async () => {
    const checker = membershipChecker(true);

    await expect(
      authorizeChallengeSource(
        {
          kind: "playlist",
          spotifyId: " playlist-1 ",
          displayName: " My Playlist ",
        },
        "access-token",
        { checkLibraryContains: checker },
      ),
    ).resolves.toEqual({ kind: "playlist", spotifyId: "playlist-1" });

    expect(checker).toHaveBeenCalledWith("access-token", "playlist", "playlist-1");

    const withoutName = await authorizeChallengeSource(
      { kind: "playlist", spotifyId: "playlist-2" },
      "access-token",
      { checkLibraryContains: checker },
    );
    expect(withoutName).toEqual({ kind: "playlist", spotifyId: "playlist-2" });
    expect(Object.isFrozen(withoutName)).toBe(true);
  });

  it("supports the named request form and rejects false membership before success", async () => {
    const checker = membershipChecker(false);
    const error = await rejectedError(
      authorizeChallengeSource({
        source: {
          kind: "album",
          spotifyId: "album-1",
          displayName: "Album",
        },
        accessToken: "access-token",
        dependencies: { checkLibraryContains: checker },
      }),
    );

    expect(error).toEqual(new SourceAuthorizationError("not_in_library"));
    expect(checker).toHaveBeenCalledTimes(1);
    expect(String(error)).not.toContain("album-1");
    expect(String(error)).not.toContain("access-token");
  });

  it("does not invoke membership checking for invalid source or token input", async () => {
    const checker = membershipChecker(true);
    const invalidSources: unknown[] = [
      null,
      [],
      { kind: "track", spotifyId: "track-1", displayName: "Track" },
      { kind: "album", spotifyId: "album/1", displayName: "Album" },
      { kind: "album", spotifyId: "album-1" },
      { kind: "album", spotifyId: "album-1", displayName: "   " },
      { kind: "playlist", spotifyId: "playlist-1", displayName: "   " },
      { kind: "playlist", spotifyId: "playlist-1", unexpected: true },
    ];

    for (const source of invalidSources) {
      await expect(
        authorizeChallengeSource(source as never, "access-token", {
          checkLibraryContains: checker,
        }),
      ).rejects.toEqual(new SourceAuthorizationError("invalid_source"));
    }

    for (const accessToken of ["", "   ", "token\nwith-control"]) {
      await expect(
        authorizeChallengeSource(
          { kind: "playlist", spotifyId: "playlist-1" },
          accessToken,
          { checkLibraryContains: checker },
        ),
      ).rejects.toEqual(new SourceAuthorizationError("invalid_token"));
    }

    expect(checker).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous named request and invalid dependency before membership checking", async () => {
    const checker = membershipChecker(true);

    await expect(
      authorizeChallengeSource({
        source: { kind: "playlist", spotifyId: "playlist-1" },
        accessToken: "access-token",
        dependencies: { checkLibraryContains: checker },
        unexpected: true,
      } as never),
    ).rejects.toEqual(new SourceAuthorizationError("invalid_input"));

    await expect(
      authorizeChallengeSource(
        { kind: "playlist", spotifyId: "playlist-1" },
        "access-token",
        { checkLibraryContains: "not-a-function" as never },
      ),
    ).rejects.toEqual(new SourceAuthorizationError("invalid_input"));

    expect(checker).not.toHaveBeenCalled();
  });

  it("propagates typed provider errors by identity and sanitizes unexpected errors", async () => {
    const providerError = new SpotifyLibraryContainsError("scope");
    const providerChecker = membershipChecker(providerError);
    const propagated = await rejectedError(
      authorizeChallengeSource(
        { kind: "playlist", spotifyId: "playlist-1" },
        "access-token",
        { checkLibraryContains: providerChecker },
      ),
    );

    expect(propagated).toBe(providerError);
    expect((propagated as SpotifyLibraryContainsError).kind).toBe("scope");

    const unexpectedSecret = "provider-secret-network-detail";
    const unexpected = await rejectedError(
      authorizeChallengeSource(
        { kind: "playlist", spotifyId: "playlist-1" },
        "access-token",
        {
          checkLibraryContains: membershipChecker(
            new Error(unexpectedSecret),
          ),
        },
      ),
    );

    expect(unexpected).toEqual(new SourceAuthorizationError("unavailable"));
    expect(String(unexpected)).not.toContain(unexpectedSecret);
  });

  it("rejects a non-boolean injected membership result without returning an authorized source", async () => {
    const checker = vi.fn(
      async (...args: [string, SpotifyLibraryItemKind, string]) => {
        expect(args).toHaveLength(3);
        return "true" as never;
      },
    );

    await expect(
      authorizeChallengeSource(
        { kind: "album", spotifyId: "album-1", displayName: "Album" },
        "access-token",
        { checkLibraryContains: checker },
      ),
    ).rejects.toEqual(new SourceAuthorizationError("invalid_response"));
  });
});
