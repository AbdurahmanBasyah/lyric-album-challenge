export type SyncedLyricLine = {
  timestampMs: number;
  text: string;
};

export type FourLineLyricWindow = [
  SyncedLyricLine,
  SyncedLyricLine,
  SyncedLyricLine,
  SyncedLyricLine,
];

export type TokenState = "hidden" | "solved" | "revealed" | "static";

export type LyricToken = Readonly<{
  id: string;
  lineIndex: number;
  tokenIndex: number;
  raw: string;
  normalized: string;
  isWord: boolean;
  state: TokenState;
}>;

export type TokenizedLyricLine = Readonly<{
  timestampMs: number;
  lineIndex: number;
  tokens: readonly LyricToken[];
}>;

export type TokenizedLyricWindow = [
  TokenizedLyricLine,
  TokenizedLyricLine,
  TokenizedLyricLine,
  TokenizedLyricLine,
];

export type AttemptNumber = 1 | 2 | 3 | 4;

export type MatchResult = Readonly<{
  matched: boolean;
}>;

export type GuessAnswers = Readonly<Record<string, string>>;

export type GuessProgress = Readonly<{
  window: TokenizedLyricWindow;
  newlySolvedTokenIds: readonly string[];
  incorrectTokenIds: readonly string[];
  unresolvedTokenIds: readonly string[];
}>;

/**
 * Cumulative fraction of eligible word tokens visible by each attempt.
 * Values must be finite, between zero and one, and non-decreasing by attempt.
 */
export type RevealConfig = Readonly<Record<AttemptNumber, number>>;

export type RevealTarget = Readonly<{
  totalWordCount: number;
  targetVisibleWordCount: number;
}>;

export type LyricWindowQualityConfig = Readonly<{
  minTotalWordCount: number;
  minUniqueWordCount: number;
  minContentWordCount: number;
  maxFillerRatio: number;
  minLexicalDiversity: number;
  minUniqueLineCount: number;
}>;

export type LyricWindowQualityMetrics = Readonly<{
  totalWordCount: number;
  uniqueWordCount: number;
  contentWordCount: number;
  fillerWordCount: number;
  fillerRatio: number;
  lexicalDiversity: number;
  uniqueLineCount: number;
}>;

export type LyricWindowRejectionReason =
  | "empty"
  | "metadata"
  | "too-short"
  | "low-diversity"
  | "insufficient-content"
  | "filler-dominated"
  | "repetitive";

export type LyricWindowQualityResult = Readonly<{
  eligible: boolean;
  qualityScore: number;
  metrics: LyricWindowQualityMetrics;
  rejectionReasons: readonly LyricWindowRejectionReason[];
}>;
