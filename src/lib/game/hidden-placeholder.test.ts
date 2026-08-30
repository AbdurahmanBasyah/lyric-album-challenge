import { describe, expect, it } from "vitest";

import {
  getHiddenTokenPlaceholder,
  MAX_HIDDEN_PLACEHOLDER_LENGTH,
} from "./hidden-placeholder";

describe("getHiddenTokenPlaceholder", () => {
  it("creates one underscore per ASCII code point", () => {
    expect(getHiddenTokenPlaceholder("hello")).toBe("_____");
  });

  it("counts Unicode code points rather than UTF-16 code units", () => {
    expect(getHiddenTokenPlaceholder("café")).toBe("____");
    expect(getHiddenTokenPlaceholder("東京")).toBe("__");
    expect(getHiddenTokenPlaceholder("🎵")).toBe("_");
  });

  it("keeps internal apostrophes hidden and counts them", () => {
    expect(getHiddenTokenPlaceholder("don't")).toBe("_____");
    expect(getHiddenTokenPlaceholder("we’re")).toBe("_____");
  });

  it("leaves punctuation handling to the static tokenizer boundary", () => {
    expect(getHiddenTokenPlaceholder("word")).toBe("____");
    expect(getHiddenTokenPlaceholder("can't")).toBe("_____");
  });

  it("rejects empty or unsupported-length values without returning an empty gap", () => {
    expect(() => getHiddenTokenPlaceholder("")).toThrow(/must not be empty/i);
    expect(() =>
      getHiddenTokenPlaceholder("x".repeat(MAX_HIDDEN_PLACEHOLDER_LENGTH + 1)),
    ).toThrow(/outside the supported length/i);
  });
});
