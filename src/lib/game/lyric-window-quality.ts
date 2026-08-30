import type {
  FourLineLyricWindow,
  LyricWindowQualityConfig,
  LyricWindowQualityMetrics,
  LyricWindowQualityResult,
  LyricWindowRejectionReason,
} from "@/types/game";

export const DEFAULT_LYRIC_WINDOW_QUALITY_CONFIG: Readonly<LyricWindowQualityConfig> = Object.freeze({
  minTotalWordCount: 12,
  minUniqueWordCount: 6,
  minContentWordCount: 4,
  maxFillerRatio: 0.4,
  minLexicalDiversity: 0.35,
  minUniqueLineCount: 3,
});

const FILLER_WORDS = new Set([
  "ah",
  "aah",
  "baby",
  "hey",
  "hmm",
  "la",
  "mm",
  "mmm",
  "na",
  "oh",
  "ooh",
  "uh",
  "um",
  "whoa",
  "woo",
  "yeah",
  "yo",
]);

const NON_CONTENT_WORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "am",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "being",
  "before",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "may",
  "me",
  "might",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "of",
  "on",
  "or",
  "our",
  "ours",
  "ourselves",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

const METADATA_LINES = new Set([
  "applause",
  "instrumental",
  "interlude",
  "intro",
  "music",
  "outro",
  "solo",
]);

const WORD_PATTERN = /[\p{L}\p{N}\p{M}]+(?:['‘’][\p{L}\p{N}\p{M}]+)*/gu;

function normalizeWord(word: string): string {
  return word.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'");
}

function extractWords(text: string): string[] {
  return (text.match(WORD_PATTERN) ?? []).map(normalizeWord);
}

function normalizeLine(text: string): string {
  return extractWords(text).join(" ");
}

function isMetadataOnlyLine(text: string): boolean {
  return METADATA_LINES.has(normalizeLine(text));
}

function isFillerWord(word: string): boolean {
  return FILLER_WORDS.has(word);
}

function isContentWord(word: string): boolean {
  return !FILLER_WORDS.has(word) && !NON_CONTENT_WORDS.has(word);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateConfig(config: LyricWindowQualityConfig): void {
  const countFields: Array<keyof LyricWindowQualityConfig> = [
    "minTotalWordCount",
    "minUniqueWordCount",
    "minContentWordCount",
    "minUniqueLineCount",
  ];

  for (const field of countFields) {
    const value = config[field];
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`Invalid lyric window quality configuration: ${field}`);
    }
  }

  const ratioFields: Array<keyof LyricWindowQualityConfig> = [
    "maxFillerRatio",
    "minLexicalDiversity",
  ];

  for (const field of ratioFields) {
    const value = config[field];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Invalid lyric window quality configuration: ${field}`);
    }
  }
}

function resolveConfig(
  config: Partial<LyricWindowQualityConfig> | undefined,
): LyricWindowQualityConfig {
  if (config !== undefined && (config === null || typeof config !== "object")) {
    throw new Error("Invalid lyric window quality configuration");
  }

  const resolvedConfig: LyricWindowQualityConfig = {
    ...DEFAULT_LYRIC_WINDOW_QUALITY_CONFIG,
    ...config,
  };

  validateConfig(resolvedConfig);
  return resolvedConfig;
}

function calculateMetrics(window: FourLineLyricWindow): {
  metrics: LyricWindowQualityMetrics;
  hasMetadataLine: boolean;
} {
  const words = window.flatMap((line) => extractWords(line.text));
  const uniqueWords = new Set(words);
  const normalizedLines = window.map((line) => normalizeLine(line.text));
  const meaningfulLines = normalizedLines.filter((line) => line.length > 0);
  const fillerWordCount = words.filter(isFillerWord).length;
  const contentWordCount = words.filter(isContentWord).length;
  const totalWordCount = words.length;

  return {
    metrics: {
      totalWordCount,
      uniqueWordCount: uniqueWords.size,
      contentWordCount,
      fillerWordCount,
      fillerRatio: totalWordCount === 0 ? 0 : fillerWordCount / totalWordCount,
      lexicalDiversity: totalWordCount === 0 ? 0 : uniqueWords.size / totalWordCount,
      uniqueLineCount: new Set(meaningfulLines).size,
    },
    hasMetadataLine: window.some((line) => isMetadataOnlyLine(line.text)),
  };
}

function calculateQualityScore(
  metrics: LyricWindowQualityMetrics,
  config: LyricWindowQualityConfig,
): number {
  const volumeScore = clamp(metrics.totalWordCount / Math.max(config.minTotalWordCount, 1), 0, 1);
  const vocabularyScore = clamp(metrics.uniqueWordCount / Math.max(config.minUniqueWordCount, 1), 0, 1);
  const contentScore = clamp(metrics.contentWordCount / Math.max(config.minContentWordCount, 1), 0, 1);
  const diversityScore = clamp(metrics.lexicalDiversity, 0, 1);
  const lineScore = clamp(metrics.uniqueLineCount / 4, 0, 1);
  const fillerPenalty = metrics.fillerRatio * 20;
  const repetitionPenalty = (1 - diversityScore) * 15 + (1 - lineScore) * 15;

  const score =
    volumeScore * 25 +
    vocabularyScore * 20 +
    contentScore * 25 +
    diversityScore * 20 +
    lineScore * 10 -
    fillerPenalty -
    repetitionPenalty;

  return clamp(Number.isFinite(score) ? score : 0, 0, 100);
}

function collectRejectionReasons(
  metrics: LyricWindowQualityMetrics,
  hasMetadataLine: boolean,
  config: LyricWindowQualityConfig,
): LyricWindowRejectionReason[] {
  if (metrics.totalWordCount === 0) {
    return ["empty"];
  }

  const reasons: LyricWindowRejectionReason[] = [];

  if (hasMetadataLine) {
    reasons.push("metadata");
  }
  if (metrics.totalWordCount < config.minTotalWordCount) {
    reasons.push("too-short");
  }
  if (
    metrics.uniqueWordCount < config.minUniqueWordCount ||
    metrics.lexicalDiversity < config.minLexicalDiversity
  ) {
    reasons.push("low-diversity");
  }
  if (metrics.contentWordCount < config.minContentWordCount) {
    reasons.push("insufficient-content");
  }
  if (metrics.fillerRatio > config.maxFillerRatio) {
    reasons.push("filler-dominated");
  }
  if (
    metrics.uniqueLineCount < config.minUniqueLineCount ||
    metrics.lexicalDiversity < config.minLexicalDiversity
  ) {
    reasons.push("repetitive");
  }

  return reasons;
}

export function evaluateLyricWindowQuality(
  window: FourLineLyricWindow,
  config?: Partial<LyricWindowQualityConfig>,
): LyricWindowQualityResult {
  const resolvedConfig = resolveConfig(config);
  const { metrics, hasMetadataLine } = calculateMetrics(window);
  const rejectionReasons = collectRejectionReasons(metrics, hasMetadataLine, resolvedConfig);

  return {
    eligible: rejectionReasons.length === 0,
    qualityScore: calculateQualityScore(metrics, resolvedConfig),
    metrics,
    rejectionReasons,
  };
}
