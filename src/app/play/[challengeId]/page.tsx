import type { Metadata } from "next";

import { ChallengeGame } from "../../../components/challenge/challenge-game";

export const metadata: Metadata = {
  title: "Play - FillTheLyrics",
  description: "Rebuild four lyric lines across four progressive hint levels.",
};

export default async function ChallengePlayPage({
  params,
}: {
  params: Promise<{ challengeId: string }>;
}) {
  const { challengeId } = await params;
  return <ChallengeGame challengeId={challengeId} />;
}
