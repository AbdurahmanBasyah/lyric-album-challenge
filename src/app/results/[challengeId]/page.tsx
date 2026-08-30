import type { Metadata } from "next";

import { ChallengeResults } from "../../../components/challenge/challenge-result";

export const metadata: Metadata = {
  title: "Results - FillTheLyrics",
  description: "Review your completed FillTheLyrics challenge.",
};

export default async function ChallengeResultsPage({
  params,
}: {
  params: Promise<{ challengeId: string }>;
}) {
  const { challengeId } = await params;
  return <ChallengeResults challengeId={challengeId} />;
}
