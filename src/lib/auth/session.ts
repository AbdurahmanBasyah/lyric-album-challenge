import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

export const AUTH_SESSION_COOKIE_NAME = "fillthelyrics_session";
export const OAUTH_STATE_COOKIE_NAME = "fillthelyrics_oauth_state";

export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const OAUTH_STATE_COOKIE_MAX_AGE_SECONDS = 60 * 10;
export const SESSION_REFRESH_WINDOW_MS = 60 * 1000;

const SESSION_VERSION = "v1";
const AES_KEY_LENGTH = 32;
const AES_IV_LENGTH = 12;
const AES_TAG_LENGTH = 16;
const MIN_SECRET_LENGTH = 32;

const sessionPayloadSchema = z
  .object({
    accessToken: z.string().trim().min(1),
    refreshToken: z.string().trim().min(1),
    expiresAt: z.number().int().positive(),
    scope: z.string().optional(),
  })
  .strict();

export type AuthSession = z.infer<typeof sessionPayloadSchema>;

export type DecryptSessionOptions = Readonly<{
  now?: number;
  allowExpired?: boolean;
}>;

export class SessionDataError extends Error {
  readonly reason: "invalid" | "expired";

  constructor(reason: "invalid" | "expired") {
    super(`Auth session data is ${reason}.`);
    this.name = "SessionDataError";
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type AuthCookieOptions = Readonly<{
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}>;

function deriveKey(secret: string): Buffer {
  if (typeof secret !== "string" || secret.trim().length < MIN_SECRET_LENGTH) {
    throw new SessionDataError("invalid");
  }

  return createHash("sha256").update(secret, "utf8").digest().subarray(0, AES_KEY_LENGTH);
}

function encodeBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function decodeBase64Url(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SessionDataError("invalid");
  }

  return Buffer.from(value, "base64url");
}

function validateSessionPayload(payload: unknown): AuthSession {
  const parsed = sessionPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    throw new SessionDataError("invalid");
  }

  return parsed.data;
}

/**
 * Encrypts only the provider values required for server-side refresh. The
 * returned value is opaque and safe to place in an HTTP-only cookie.
 */
export function encryptSession(session: AuthSession, secret: string): string {
  const payload = validateSessionPayload(session);
  const key = deriveKey(secret);
  const iv = randomBytes(AES_IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    SESSION_VERSION,
    encodeBase64Url(iv),
    encodeBase64Url(ciphertext),
    encodeBase64Url(authTag),
  ].join(".");
}

/**
 * Decrypts and validates an auth cookie. Expired payloads are rejected by
 * default; the session route may opt in to reading an expired payload once so
 * it can use its refresh token before deciding the user is unauthenticated.
 */
export function decryptSession(
  encodedSession: string,
  secret: string,
  options: DecryptSessionOptions = {},
): AuthSession {
  try {
    const parts = encodedSession.split(".");

    if (parts.length !== 4 || parts[0] !== SESSION_VERSION) {
      throw new SessionDataError("invalid");
    }

    const iv = decodeBase64Url(parts[1]);
    const ciphertext = decodeBase64Url(parts[2]);
    const authTag = decodeBase64Url(parts[3]);

    if (
      iv.length !== AES_IV_LENGTH ||
      ciphertext.length === 0 ||
      authTag.length !== AES_TAG_LENGTH
    ) {
      throw new SessionDataError("invalid");
    }

    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const payload = validateSessionPayload(JSON.parse(plaintext));
    const now = options.now ?? Date.now();

    if (!options.allowExpired && payload.expiresAt <= now) {
      throw new SessionDataError("expired");
    }

    return payload;
  } catch (error) {
    if (error instanceof SessionDataError) {
      throw error;
    }

    throw new SessionDataError("invalid");
  }
}

export function isSessionExpiringSoon(
  session: Pick<AuthSession, "expiresAt">,
  now = Date.now(),
  refreshWindowMs = SESSION_REFRESH_WINDOW_MS,
): boolean {
  return session.expiresAt <= now + refreshWindowMs;
}

export function usesSecureCookies(appUrl: string): boolean {
  try {
    return new URL(appUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export function getSessionCookieOptions(secure: boolean): AuthCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}

export function getStateCookieOptions(secure: boolean): AuthCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: OAUTH_STATE_COOKIE_MAX_AGE_SECONDS,
  };
}

export function getClearCookieOptions(secure: boolean): AuthCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  };
}
