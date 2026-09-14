import { MAX_STREAK } from "../game/scoring";

export type ResultQuestionStatus = "active" | "solved" | "failed";

export type ResultQuestionFacts = Readonly<{
  status: ResultQuestionStatus;
  attempt: number;
}>;

/** A Perfect round is solved on the first / Expert attempt. */
export function isPerfectQuestion(
  question: ResultQuestionFacts,
  attemptsUsed: number = question.attempt,
): boolean {
  return question.status === "solved" && attemptsUsed === 1;
}

/** Count terminal questions solved on Expert, including baseline visibility. */
export function getPerfectQuestionCount(
  questions: readonly ResultQuestionFacts[],
): number {
  return questions.filter((question) => isPerfectQuestion(question)).length;
}

/** Find the longest consecutive solved-song run in challenge order. */
export function getBestSolvedSongStreak(
  questions: readonly Pick<ResultQuestionFacts, "status">[],
): number {
  let current = 0;
  let best = 0;

  for (const question of questions) {
    if (question.status === "active") {
      // Incomplete recovery views have no terminal outcome for this question.
      continue;
    }

    if (question.status === "failed") {
      current = 0;
      continue;
    }

    current = Math.min(MAX_STREAK, current + 1);
    best = Math.max(best, current);
  }

  return best;
}
