import { z } from "zod";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/**
 * Spotify accepts HTTPS redirect URIs in production and 127.0.0.1 HTTP
 * redirect URIs for local development. A localhost HTTP redirect is
 * intentionally rejected so local setup uses one explicit browser origin.
 */
export function isValidSpotifyRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);

    if (
      !url.pathname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return false;
    }

    if (url.protocol === "https:") {
      return url.hostname.length > 0;
    }

    return url.protocol === "http:" && url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const environmentSchema = z.object({
  SPOTIFY_CLIENT_ID: z.string().trim().min(1),
  SPOTIFY_CLIENT_SECRET: z.string().trim().min(1),
  SPOTIFY_REDIRECT_URI: z.string().trim().refine(isValidSpotifyRedirectUri),
  NEXT_PUBLIC_APP_URL: z.string().trim().url().refine(isHttpUrl),
  AUTH_SESSION_SECRET: z.string().trim().min(32),
  // The YouTube resolver is optional and remains server-only. Treat an empty
  // .env value as unset so the public/gameplay MVP does not require YouTube.
  YOUTUBE_API_KEY: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : value,
    z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value))
      .optional(),
  ),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

export type EnvironmentInput = Readonly<{
  SPOTIFY_CLIENT_ID?: unknown;
  SPOTIFY_CLIENT_SECRET?: unknown;
  SPOTIFY_REDIRECT_URI?: unknown;
  NEXT_PUBLIC_APP_URL?: unknown;
  AUTH_SESSION_SECRET?: unknown;
  YOUTUBE_API_KEY?: unknown;
  NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET?: unknown;
  NEXT_PUBLIC_AUTH_SESSION_SECRET?: unknown;
  NEXT_PUBLIC_YOUTUBE_API_KEY?: unknown;
}>;

export type EnvironmentField = keyof EnvironmentInput;

const publicSecretFields = [
  "NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET",
  "NEXT_PUBLIC_AUTH_SESSION_SECRET",
  "NEXT_PUBLIC_YOUTUBE_API_KEY",
] as const satisfies readonly EnvironmentField[];

export class EnvironmentConfigurationError extends Error {
  readonly fields: readonly EnvironmentField[];

  constructor(fields: readonly EnvironmentField[]) {
    super(`Invalid environment configuration for: ${fields.join(", ")}.`);
    this.name = "EnvironmentConfigurationError";
    this.fields = [...fields];
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function getInvalidFields(issues: readonly z.core.$ZodIssue[]): EnvironmentField[] {
  const fields = new Set<EnvironmentField>();

  for (const issue of issues) {
    const field = issue.path[0];

    if (
      field === "SPOTIFY_CLIENT_ID" ||
      field === "SPOTIFY_CLIENT_SECRET" ||
      field === "SPOTIFY_REDIRECT_URI" ||
      field === "NEXT_PUBLIC_APP_URL" ||
      field === "AUTH_SESSION_SECRET" ||
      field === "YOUTUBE_API_KEY"
    ) {
      fields.add(field);
    }
  }

  return [...fields];
}

/**
 * Validates a supplied environment-like object without reading process.env.
 * Provider credentials and the session secret are intentionally not inferred
 * from public browser variables.
 */
export function parseEnvironment(environment: EnvironmentInput): AppEnvironment {
  const invalidFields = new Set<EnvironmentField>();
  const parsed = environmentSchema.safeParse(environment);

  if (!parsed.success) {
    for (const field of getInvalidFields(parsed.error.issues)) {
      invalidFields.add(field);
    }
  }

  for (const field of publicSecretFields) {
    if (environment[field] !== undefined) {
      invalidFields.add(field);
    }
  }

  if (invalidFields.size > 0 || !parsed.success) {
    throw new EnvironmentConfigurationError([...invalidFields]);
  }

  return parsed.data;
}

/**
 * Reads and validates server configuration only when explicitly requested.
 */
export function getServerEnvironment(): AppEnvironment {
  return parseEnvironment({
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    SPOTIFY_REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET:
      process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET,
    NEXT_PUBLIC_AUTH_SESSION_SECRET: process.env.NEXT_PUBLIC_AUTH_SESSION_SECRET,
    NEXT_PUBLIC_YOUTUBE_API_KEY: process.env.NEXT_PUBLIC_YOUTUBE_API_KEY,
  });
}
