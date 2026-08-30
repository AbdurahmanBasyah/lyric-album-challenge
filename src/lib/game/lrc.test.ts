import { describe, expect, it } from "vitest";

import { parseLrc, parseLrcTimestamp } from "./lrc";

describe("parseLrcTimestamp", () => {
  it("parses centisecond timestamps", () => {
    expect(parseLrcTimestamp("01:23.45")).toBe(83_450);
  });

  it("parses millisecond timestamps", () => {
    expect(parseLrcTimestamp("01:23.450")).toBe(83_450);
  });

  it("accepts a bracketed timestamp", () => {
    expect(parseLrcTimestamp("[01:23.45]")).toBe(83_450);
  });

  it("rejects timestamps with invalid seconds or malformed syntax", () => {
    expect(parseLrcTimestamp("01:60.00")).toBeNull();
    expect(parseLrcTimestamp("01:23")).toBeNull();
    expect(parseLrcTimestamp("not-a-timestamp")).toBeNull();
  });
});

describe("parseLrc", () => {
  it("ignores metadata, blank lyrics, and malformed rows", () => {
    const input = [
      "[ar:Synthetic Artist]",
      "[ti:Synthetic Track]",
      "[offset:0]",
      "",
      "not a timestamp row",
      "[01:60.00]Invalid seconds",
      "[01:10.00]",
      "[01:11]Missing fraction",
      "[00:01.00]Valid line",
    ].join("\n");

    expect(parseLrc(input)).toEqual([{ timestampMs: 1_000, text: "Valid line" }]);
  });

  it("supports CRLF line endings", () => {
    expect(parseLrc("[00:01.00]First\r\n[00:02.00]Second")).toEqual([
      { timestampMs: 1_000, text: "First" },
      { timestampMs: 2_000, text: "Second" },
    ]);
  });

  it("creates one line for each timestamp on a row", () => {
    expect(parseLrc("[00:03.00][00:01.00]Repeated line")).toEqual([
      { timestampMs: 1_000, text: "Repeated line" },
      { timestampMs: 3_000, text: "Repeated line" },
    ]);
  });

  it("sorts chronologically and preserves source order for equal timestamps", () => {
    const input = [
      "[00:03.00]Third",
      "[00:01.00]First",
      "[00:02.00]Second",
      "[00:02.00]Second at the same timestamp",
    ].join("\n");

    expect(parseLrc(input)).toEqual([
      { timestampMs: 1_000, text: "First" },
      { timestampMs: 2_000, text: "Second" },
      { timestampMs: 2_000, text: "Second at the same timestamp" },
      { timestampMs: 3_000, text: "Third" },
    ]);
  });
});
