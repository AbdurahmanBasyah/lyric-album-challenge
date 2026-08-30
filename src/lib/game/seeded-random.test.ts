import { describe, expect, it } from "vitest";

import { createSeededRandom, seededShuffle, seededTake } from "./seeded-random";

describe("createSeededRandom", () => {
  it("keeps the algorithm's golden vector stable", () => {
    const random = createSeededRandom("alpha");

    expect(Array.from({ length: 5 }, () => random())).toEqual([
      0.5000494201667607,
      0.26153493020683527,
      0.9985202180687338,
      0.9693092019297183,
      0.7176881378982216,
    ]);
  });

  it("returns finite values in the half-open unit interval", () => {
    const random = createSeededRandom("range-check");
    const values = Array.from({ length: 10_000 }, () => random());

    expect(values.every((value) => Number.isFinite(value) && value >= 0 && value < 1)).toBe(true);
  });

  it("is deterministic for equal seeds and distinguishes a different seed", () => {
    const first = createSeededRandom("same-seed");
    const second = createSeededRandom("same-seed");
    const different = createSeededRandom("different-seed");

    const firstValues = Array.from({ length: 20 }, () => first());
    const secondValues = Array.from({ length: 20 }, () => second());
    const differentValues = Array.from({ length: 20 }, () => different());

    expect(firstValues).toEqual(secondValues);
    expect(firstValues).not.toEqual(differentValues);
  });

  it("supports empty and Unicode seeds without sharing mutable state", () => {
    const emptyFirst = createSeededRandom("");
    const emptySecond = createSeededRandom("");
    const unicodeFirst = createSeededRandom("😀 संगीत");
    const unicodeSecond = createSeededRandom("😀 संगीत");

    expect(emptyFirst()).toBe(emptySecond());
    expect(Array.from({ length: 5 }, () => unicodeFirst())).toEqual(
      Array.from({ length: 5 }, () => unicodeSecond()),
    );
  });
});

describe("seededShuffle", () => {
  it("returns a deterministic permutation without mutating the source", () => {
    const source = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const original = [...source];

    const first = seededShuffle(source, "alpha");
    const second = seededShuffle(source, "alpha");

    expect(first).toEqual([9, 0, 8, 3, 1, 4, 6, 7, 2, 5]);
    expect(second).toEqual(first);
    expect(source).toEqual(original);
    expect(first).not.toBe(source);
    expect([...first].sort((left, right) => left - right)).toEqual(original);
  });

  it("produces different fixture orders for different seeds", () => {
    const source = Array.from({ length: 12 }, (_, index) => index);

    expect(seededShuffle(source, "alpha")).not.toEqual(seededShuffle(source, "beta"));
  });

  it("preserves object identity and handles empty and singleton inputs", () => {
    const first = { name: "first" };
    const second = { name: "second" };
    const source = [first, second] as const;

    expect(seededShuffle([], "alpha")).toEqual([]);
    const singleton = seededShuffle([first], "alpha");
    expect(singleton).toEqual([first]);
    expect(singleton[0]).toBe(first);

    const shuffled = seededShuffle(source, "alpha");
    expect(shuffled).toHaveLength(2);
    expect(shuffled).toEqual(expect.arrayContaining([first, second]));
    expect(shuffled).toContain(first);
    expect(shuffled).toContain(second);
    expect(shuffled).not.toBe(source);
  });

  it("accepts a frozen source array", () => {
    const source = Object.freeze(["one", "two", "three"]);

    expect(seededShuffle(source, "frozen")).toHaveLength(3);
  });
});

describe("seededTake", () => {
  const source = ["a", "b", "c", "d", "e"];

  it("returns an empty array for zero and a complete shuffled copy when over-length", () => {
    expect(seededTake(source, 0, "alpha")).toEqual([]);

    const all = seededTake(source, source.length + 10, "alpha");
    expect(all).toEqual(seededShuffle(source, "alpha"));
    expect(all).not.toBe(source);
  });

  it("returns a deterministic prefix for a partial take without mutation", () => {
    const original = [...source];

    expect(seededTake(source, 3, "alpha")).toEqual(seededShuffle(source, "alpha").slice(0, 3));
    expect(source).toEqual(original);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid count %s",
    (count) => {
      expect(() => seededTake(source, count, "alpha")).toThrow(
        "seededTake count must be a finite non-negative integer",
      );
    },
  );

  it("works with a frozen source array", () => {
    const frozenSource = Object.freeze(["one", "two", "three"]);

    expect(seededTake(frozenSource, 2, "frozen")).toHaveLength(2);
  });
});
