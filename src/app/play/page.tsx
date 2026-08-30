import type { Metadata } from "next";

import { ChallengeIntro } from "../../components/challenge/challenge-intro";
import { parseChallengeSourceContext } from "../../components/challenge/challenge-api";

export const metadata: Metadata = {
  title: "Challenge setup - FillTheLyrics",
  description:
    "Start a lyric reconstruction challenge from a public playlist or saved music.",
};

export default async function PlayIntroPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const source = parseChallengeSourceContext(await searchParams);
  return <ChallengeIntro source={source} />;
}
