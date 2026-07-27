import type {
  RestaurantProvider,
  RestaurantSearchInput,
  RestaurantSearchResult,
} from "@/domain/restaurants/provider";

/**
 * Caches searches, and — more importantly — serves a stale result when the
 * upstream source fails.
 *
 * Restaurants do not move. A listing fetched last week is as useful as one
 * fetched this second, which makes staleness an almost free way to absorb an
 * outage: the group gets their options instead of "couldn't reach the
 * listings", and never notices the difference. That property is what makes this
 * worth more than the latency saving.
 *
 * Keyed on the location text the group actually typed, because that repeats far
 * more than coordinates would — the same chat asks about the same neighbourhood
 * over and over.
 */

interface CacheEntry {
  result: RestaurantSearchResult;
  storedAt: number;
}

export interface CacheOptions {
  /** How long a result is served without re-fetching. */
  ttlMs?: number;
  /** Bounds memory on a long-lived process. */
  maxEntries?: number;
  now?: () => number;
  /** Injected in tests; defaults to a warn so stale serving is visible. */
  onStale?: (error: unknown, ageMs: number) => void;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 200;

export class CachedRestaurantProvider implements RestaurantProvider {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly onStale: (error: unknown, ageMs: number) => void;

  constructor(
    private readonly inner: RestaurantProvider,
    options: CacheOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? (() => Date.now());
    this.onStale =
      options.onStale ??
      ((error, ageMs) =>
        console.warn(
          `[viand] serving restaurants cached ${Math.round(ageMs / 3_600_000)}h ago; ` +
            `upstream failed:`,
          error,
        ));
  }

  async search(input: RestaurantSearchInput): Promise<RestaurantSearchResult> {
    const key = cacheKey(input);
    const cached = this.entries.get(key);

    if (cached && this.now() - cached.storedAt < this.ttlMs) {
      return cached.result;
    }

    try {
      const result = await this.inner.search(input);
      // An empty result is not worth caching: it is usually a bad location or a
      // half-answered query, and caching it would pin that failure in place.
      if (result.restaurants.length > 0) this.store(key, result);
      return result;
    } catch (error) {
      if (cached) {
        this.onStale(error, this.now() - cached.storedAt);
        return cached.result;
      }
      throw error;
    }
  }

  private store(key: string, result: RestaurantSearchResult): void {
    // Oldest-first eviction; insertion order is what Map iteration gives us.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.delete(key);
    this.entries.set(key, { result, storedAt: this.now() });
  }
}

export function cacheKey(input: RestaurantSearchInput): string {
  const location = input.locationText.trim().toLowerCase().replace(/\s+/g, " ");
  return [
    location,
    input.radiusMiles,
    input.maxPriceLevel ?? "",
    input.openNowOnly ? "open" : "",
  ].join("|");
}
