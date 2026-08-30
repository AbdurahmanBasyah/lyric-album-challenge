import type { SyncedLyricLine } from "@/types/game";

const TIMESTAMP_PATTERN = /^(\d+):([0-5]\d)\.(\d{2}|\d{3})$/;

/**
 * Converts an LRC timestamp to milliseconds.
 *
 * LRC commonly represents the fractional seconds with either two digits
 * (centiseconds) or three digits (milliseconds). The function accepts both
 * a bare timestamp and a timestamp wrapped in square brackets.
 */
export function parseLrcTimestamp(value: string): number | null {
  const trimmed = value.trim();
  const isBracketed = trimmed.startsWith("[") || trimmed.endsWith("]");
  const timestamp = isBracketed
    ? trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : null
    : trimmed;

  if (timestamp === null) {
    return null;
  }

  const match = TIMESTAMP_PATTERN.exec(timestamp);
  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fractional = match[3];

  if (!Number.isSafeInteger(minutes)) {
    return null;
  }

  const fractionalMilliseconds = Number(fractional) * (fractional.length === 2 ? 10 : 1);
  const timestampMs = minutes * 60_000 + seconds * 1_000 + fractionalMilliseconds;

  return Number.isSafeInteger(timestampMs) ? timestampMs : null;
}

type ParsedLine = SyncedLyricLine & { sourceOrder: number };

function readLeadingTags(line: string): { tags: string[]; textStart: number } {
  const trimmedStart = line.length - line.trimStart().length;
  let cursor = trimmedStart;
  const tags: string[] = [];

  while (line[cursor] === "[") {
    const closingBracket = line.indexOf("]", cursor + 1);
    if (closingBracket === -1) {
      return { tags: [], textStart: line.length };
    }

    tags.push(line.slice(cursor + 1, closingBracket));
    cursor = closingBracket + 1;

    while (/\s/.test(line[cursor] ?? "")) {
      cursor += 1;
    }
  }

  return { tags, textStart: cursor };
}

/**
 * Parses a synced LRC document into chronological lyric lines.
 *
 * Malformed rows, metadata-only rows, blank rows, and rows without a valid
 * timestamp are ignored. Multiple timestamps on one row produce one line per
 * timestamp while preserving the source order for equal timestamps.
 */
export function parseLrc(input: string): SyncedLyricLine[] {
  const parsedLines: ParsedLine[] = [];
  let sourceOrder = 0;

  for (const rawLine of input.split(/\r\n?|\n/)) {
    const { tags, textStart } = readLeadingTags(rawLine);
    if (tags.length === 0) {
      continue;
    }

    const text = rawLine.slice(textStart).trim();
    if (text.length === 0) {
      continue;
    }

    for (const tag of tags) {
      const timestampMs = parseLrcTimestamp(tag);
      if (timestampMs === null) {
        continue;
      }

      parsedLines.push({ timestampMs, text, sourceOrder });
      sourceOrder += 1;
    }
  }

  parsedLines.sort((left, right) => {
    const timestampDifference = left.timestampMs - right.timestampMs;
    return timestampDifference === 0
      ? left.sourceOrder - right.sourceOrder
      : timestampDifference;
  });

  return parsedLines.map(({ timestampMs, text }) => ({ timestampMs, text }));
}
