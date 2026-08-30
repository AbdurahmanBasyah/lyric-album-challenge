import type { FourLineLyricWindow, SyncedLyricLine } from "@/types/game";

export function generateFourLineWindows(
  lines: readonly SyncedLyricLine[],
): FourLineLyricWindow[] {
  const windows: FourLineLyricWindow[] = [];

  for (let index = 0; index <= lines.length - 4; index += 1) {
    windows.push(lines.slice(index, index + 4) as FourLineLyricWindow);
  }

  return windows;
}
