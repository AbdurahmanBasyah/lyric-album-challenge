const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32_RANGE = 0x1_0000_0000;

/**
 * Hashes a JavaScript string by UTF-16 code unit into an unsigned 32-bit seed.
 * FNV-1a is deliberately used as a small, stable, non-cryptographic hash.
 */
function hashSeed(seed: string): number {
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

/**
 * Creates a deterministic non-cryptographic PRNG for game selection.
 *
 * This is not suitable for OAuth state, tokens, security decisions, or any
 * other use that requires cryptographic randomness.
 */
export function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed);

  return () => {
    // Mulberry32 advances a private 32-bit state on every call.
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/**
 * Returns an immutable Fisher-Yates shuffle driven by a string seed.
 * The returned array is a new array and item references are preserved.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const shuffled = [...items];
  const random = createSeededRandom(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function assertValidCount(count: number): void {
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0) {
    throw new Error("seededTake count must be a finite non-negative integer");
  }
}

/**
 * Returns up to `count` items from a deterministic seeded shuffle.
 * A count at or above the source length returns the complete shuffled copy.
 */
export function seededTake<T>(items: readonly T[], count: number, seed: string): T[] {
  assertValidCount(count);

  if (count === 0) {
    return [];
  }

  return seededShuffle(items, seed).slice(0, count);
}
