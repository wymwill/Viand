/**
 * Seeded pseudo-randomness for the eval corpus.
 *
 * mulberry32: small, fast, and — the only property that matters here —
 * identical everywhere. `Math.random` cannot be used because a corpus that
 * changes between runs makes two eval results incomparable, which defeats the
 * point of measuring a refactor against it.
 *
 * Every draw in the generator goes through one instance of this in a fixed
 * order, so the corpus is a pure function of the seed. `tests/unit/eval-*`
 * pins that with a hash.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform in [min, max), rounded to `places`. */
  round(min: number, max: number, places: number): number {
    return Number(this.float(min, max).toFixed(places));
  }

  bool(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick called with an empty array");
    return items[this.int(0, items.length - 1)] as T;
  }

  /** `count` distinct items, or all of them if `count` exceeds the length. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const taken: T[] = [];
    const wanted = Math.min(count, pool.length);
    for (let i = 0; i < wanted; i += 1) {
      const index = this.int(0, pool.length - 1);
      taken.push(pool[index] as T);
      pool.splice(index, 1);
    }
    return taken;
  }
}

/**
 * Order-sensitive digest of any JSON-serialisable value. Used to pin the
 * generated corpus: if a refactor perturbs the sequence of draws, the corpus
 * silently becomes a different benchmark, and this catches it.
 */
export function digest(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (((h2 >>> 0) * 4294967296 + (h1 >>> 0)) >>> 0).toString(16).padStart(8, "0");
}
