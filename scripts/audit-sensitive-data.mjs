#!/usr/bin/env node

/**
 * Static privacy guard for the release build.
 *
 * This intentionally scans production source and generated browser assets,
 * not arbitrary repository text.  Test files and provider fixtures are the
 * only source exclusions: they contain synthetic payloads needed to exercise
 * the adapters and are never part of a production build.  No environment file
 * is read by this script, so running it cannot print a configured secret.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const GENERATED_EXTENSIONS = new Set([
  ".cjs",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".map",
  ".mjs",
]);

const SENSITIVE_IDENTIFIER =
  /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization[_-]?code|api[_-]?key|hidden[_-]?answers?|answer[_-]?key|plain[_-]?lyrics|synced[_-]?lyrics|lyricsfile|raw[_-]?lyrics|provider[_-]?(?:body|response)|response[_-]?body)\b/giu;

// Keep this client/build pattern limited to values that are secrets or raw
// provider/lyric material. Generic transport names such as `response`,
// `body`, and ordinary submitted `answers` are safe application vocabulary.
const CLIENT_SENSITIVE_IDENTIFIER =
  /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization[_-]?code|api[_-]?key|hidden[_-]?answers?|answer[_-]?key|plain[_-]?lyrics|synced[_-]?lyrics|lyricsfile|raw[_-]?lyrics|provider[_-]?(?:body|response)|response[_-]?body)\b/giu;

const PUBLIC_SECRET_ENV =
  /\b(?:process\.env\.)?NEXT_PUBLIC_(?:SPOTIFY_CLIENT_SECRET|AUTH_SESSION_SECRET|YOUTUBE_API_KEY)\b/giu;

const PROVIDER_API_URL =
  /https?:\/\/(?:api\.spotify\.com|lrclib\.net(?:\/|$)|(?:www\.)?googleapis\.com\/youtube)\b/giu;

const LOG_CALL =
  /\b(?:console|logger)\.(?:debug|dir|error|info|log|table|warn)\s*\(/giu;

const JSON_OBJECT_OUTPUT =
  /\b(?:NextResponse|Response|res)\.json\s*\(\s*\{([\s\S]{0,1200}?)\}/giu;

const DIRECT_RESPONSE_OUTPUT =
  /\bnew\s+Response\s*\(\s*(?:rawBody|providerBody|responseBody|rawResponse|providerResponse)\b/giu;

const STRINGIFY_SENSITIVE =
  /\bJSON\.stringify\s*\(\s*(?:rawResponse|providerResponse|rawBody|providerBody|accessToken|refreshToken|clientSecret|authorizationCode|hiddenAnswers|plainLyrics|syncedLyrics|rawLyrics)\b/giu;

function isTestOrFixture(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");

  return (
    /(^|\/)fixtures(\/|$)/iu.test(normalized) ||
    /(?:^|\/)__tests__(\/|$)/iu.test(normalized) ||
    /\.test\.[^.\/]+$/iu.test(normalized) ||
    /\.spec\.[^.\/]+$/iu.test(normalized)
  );
}

function collectFiles(rootPath, extensions, relativePrefix = "") {
  if (!existsSync(rootPath)) {
    return [];
  }

  const files = [];
  const entries = readdirSync(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(rootPath, entry.name);
    const relativePath = relativePrefix
      ? join(relativePrefix, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath, extensions, relativePath));
      continue;
    }

    if (extensions.has(extname(entry.name).toLowerCase())) {
      files.push({ absolutePath, relativePath: relativePath.replaceAll("\\", "/") });
    }
  }

  return files;
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function addFinding(findings, file, rule, index) {
  findings.push({
    file: file.relativePath,
    line: lineNumberAt(file.text, index),
    rule,
  });
}

function testPattern(pattern, text) {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function scanSourceFile(file, findings) {
  const text = file.text;
  const isClientModule = /^\s*["']use client["'];?/mu.test(text);

  for (const match of text.matchAll(PUBLIC_SECRET_ENV)) {
    // env.ts deliberately reads these names only to reject unsafe deployment
    // configuration.  A use of the same variables anywhere else is an
    // attempted public exposure and must fail the audit.
    if (file.relativePath !== "src/lib/env.ts") {
      addFinding(findings, file, "public server-only environment variable", match.index);
    }
  }

  for (const match of text.matchAll(LOG_CALL)) {
    const callStart = match.index + match[0].length;
    const argumentsText = text.slice(callStart, callStart + 1_200);
    const closingIndex = argumentsText.search(/[\n;]/u);
    const boundedArguments =
      closingIndex >= 0 ? argumentsText.slice(0, closingIndex) : argumentsText;

    if (testPattern(SENSITIVE_IDENTIFIER, boundedArguments) || /\b(?:error|exception|response|body|request|url)\b/iu.test(boundedArguments)) {
      addFinding(findings, file, "sensitive value in log call", match.index);
    }
  }

  for (const match of text.matchAll(JSON_OBJECT_OUTPUT)) {
    if (testPattern(SENSITIVE_IDENTIFIER, match[1])) {
      addFinding(findings, file, "sensitive field in JSON response", match.index);
    }
  }

  for (const match of text.matchAll(DIRECT_RESPONSE_OUTPUT)) {
    addFinding(findings, file, "raw provider response returned", match.index);
  }

  for (const match of text.matchAll(STRINGIFY_SENSITIVE)) {
    addFinding(findings, file, "sensitive value serialized for transport", match.index);
  }

  if (isClientModule) {
    for (const match of text.matchAll(CLIENT_SENSITIVE_IDENTIFIER)) {
      addFinding(findings, file, "server-only or raw provider value in client source", match.index);
    }

    if (testPattern(PROVIDER_API_URL, text)) {
      addFinding(findings, file, "provider API URL in client source", text.search(PROVIDER_API_URL));
    }
  }
}

function scanGeneratedFile(file, findings) {
  const text = file.text;

  for (const match of text.matchAll(PUBLIC_SECRET_ENV)) {
    addFinding(findings, file, "server-only environment variable in client build", match.index);
  }

  for (const match of text.matchAll(CLIENT_SENSITIVE_IDENTIFIER)) {
    addFinding(findings, file, "server-only or raw provider value in client build", match.index);
  }

  if (testPattern(PROVIDER_API_URL, text)) {
    addFinding(findings, file, "provider API URL in client build", text.search(PROVIDER_API_URL));
  }
}

function readTextFile(file) {
  try {
    const text = readFileSync(file.absolutePath, "utf8");

    // Binary assets are not JavaScript client output and can contain arbitrary
    // bytes that make textual matching meaningless.
    if (text.includes("\u0000")) {
      return null;
    }

    return text;
  } catch {
    return null;
  }
}

const findings = [];
const sourceFiles = [
  ...collectFiles(join(repositoryRoot, "src"), SOURCE_EXTENSIONS, "src"),
  ...["next.config.ts", "next.config.js", "middleware.ts", "middleware.js"]
    .map((name) => ({
      absolutePath: join(repositoryRoot, name),
      relativePath: name,
    }))
    .filter((file) => existsSync(file.absolutePath)),
].filter((file) => !isTestOrFixture(file.relativePath));

for (const file of sourceFiles) {
  const text = readTextFile(file);

  if (text === null) {
    continue;
  }

  scanSourceFile({ ...file, text }, findings);
}

const generatedRoots = [
  [".next/static", join(repositoryRoot, ".next", "static")],
  ["out", join(repositoryRoot, "out")],
  ["build", join(repositoryRoot, "build")],
];
let generatedFileCount = 0;

for (const [relativeRoot, absoluteRoot] of generatedRoots) {
  const generatedFiles = collectFiles(absoluteRoot, GENERATED_EXTENSIONS, relativeRoot);
  generatedFileCount += generatedFiles.length;

  for (const file of generatedFiles) {
    const text = readTextFile(file);

    if (text === null) {
      continue;
    }

    scanGeneratedFile({ ...file, text }, findings);
  }
}

if (findings.length > 0) {
  console.error(`Privacy audit failed with ${findings.length} finding(s):`);

  for (const finding of findings) {
    // Report only fixed rule labels and source locations.  Never print the
    // matched value, line, URL, provider body, or environment contents.
    console.error(`- ${finding.file}:${finding.line} (${finding.rule})`);
  }

  process.exitCode = 1;
} else {
  const generatedMessage =
    generatedFileCount === 0
      ? "no generated client output found"
      : `${generatedFileCount} generated client file(s) scanned`;
  console.log(`Privacy audit passed: production source scanned; ${generatedMessage}.`);
}
