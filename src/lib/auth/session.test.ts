import { describe, expect, it } from "vitest";

import {
  AUTH_SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SessionDataError,
  decryptSession,
  encryptSession,
  getClearCookieOptions,
  getSessionCookieOptions,
  getStateCookieOptions,
  isSessionExpiringSoon,
  usesSecureCookies,
} from "./session";

const secret = "unit-test-session-secret-with-at-least-32-chars";
const session = {
  accessToken: "access-token-value",
  refreshToken: "refresh-token-value",
  expiresAt: 1_700_003_600_000,
  scope: "user-library-read",
} as const;

describe("encrypted auth session", () => {
  it("round-trips a valid session payload", () => {
    const encoded = encryptSession(session, secret);

    expect(encoded).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(decryptSession(encoded, secret, { now: 1_700_000_000_000 })).toEqual(
      session,
    );
    expect(encoded).not.toContain(session.accessToken);
    expect(encoded).not.toContain(session.refreshToken);
  });

  it("rejects tampered, malformed, and wrongly keyed values", () => {
    const encoded = encryptSession(session, secret);
    const parts = encoded.split(".");
    parts[2] = `${parts[2]}a`;

    expect(() => decryptSession(parts.join("."), secret)).toThrow(SessionDataError);
    expect(() => decryptSession(encoded, `${secret}-wrong`)).toThrow(SessionDataError);
    expect(() => decryptSession("not-a-session", secret)).toThrow(SessionDataError);
  });

  it("rejects an expired value by default but permits one server refresh read", () => {
    const encoded = encryptSession(session, secret);
    const now = session.expiresAt + 1;

    expect(() => decryptSession(encoded, secret, { now })).toThrow(/expired/);
    expect(
      decryptSession(encoded, secret, { now, allowExpired: true }),
    ).toEqual(session);
  });

  it("rejects a weak encryption secret", () => {
    expect(() => encryptSession(session, "too-short")).toThrow(SessionDataError);
  });

  it("does not accept extra unvalidated payload fields", () => {
    expect(() =>
      encryptSession(
        {
          ...session,
          unexpected: "must-not-be-stored",
        } as never,
        secret,
      ),
    ).toThrow(SessionDataError);
  });
});

describe("auth cookie policy", () => {
  it("uses secure cookies for HTTPS and allows explicit local HTTP behavior", () => {
    expect(usesSecureCookies("https://fillthelyrics.example.com")).toBe(true);
    expect(usesSecureCookies("http://127.0.0.1:3000")).toBe(false);
    expect(usesSecureCookies("not-a-url")).toBe(false);

    const secure = getSessionCookieOptions(true);
    expect(secure).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
  });

  it("bounds state cookies and provides path-scoped clearing options", () => {
    expect(getStateCookieOptions(false)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: OAUTH_STATE_COOKIE_MAX_AGE_SECONDS,
    });
    expect(getClearCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
    expect(AUTH_SESSION_COOKIE_NAME).not.toBe(OAUTH_STATE_COOKIE_NAME);
  });
});

describe("session refresh threshold", () => {
  it("refreshes only when expiry is within the configured window", () => {
    expect(isSessionExpiringSoon({ expiresAt: 1_000_000 }, 1_000_000 - 60_000)).toBe(
      true,
    );
    expect(isSessionExpiringSoon({ expiresAt: 1_000_001 }, 1_000_000 - 60_000)).toBe(
      false,
    );
    expect(isSessionExpiringSoon({ expiresAt: 999_000 }, 1_000_000)).toBe(true);
  });
});
