import type { RestaurantSearchResult } from "@/domain/restaurants/provider";
import { logDegradation } from "../observability/log";
import type { RedisTransport } from "../store/redis-transport";

/**
 * One cached search.
 *
 * `hourBucket` records the hour the result's `openNow` values were computed in.
 * Freshness is gated on it, but lookup is not: a stale entry from an earlier
 * hour must still be findable, because serving slightly wrong hours during an
 * upstream outage beats telling the group there is nowhere to eat.
 */
export interface CacheEntry {
  result: RestaurantSearchResult;
  storedAt: number;
  hourBucket: string;
}

/**
 * Where cached searches live.
 *
 * A cache is not a store: every method here may fail, and a failure must read
 * as a miss rather than an error. Losing the cache costs a slow search, while
 * propagating the failure would cost the group their answer.
 */
export interface RestaurantCacheBackend {
  read(key: string): Promise<CacheEntry | null>;
  write(key: string, entry: CacheEntry, ttlMs: number): Promise<void>;
}

/**
 * Process-local cache. The default, and the only one the test suite and the
 * simulator need — neither should require an external service.
 */
export class MemoryCacheBackend implements RestaurantCacheBackend {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly maxEntries = 200) {}

  async read(key: string): Promise<CacheEntry | null> {
    return this.entries.get(key) ?? null;
  }

  async write(key: string, entry: CacheEntry): Promise<void> {
    // Oldest-first eviction; insertion order is what Map iteration gives us.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  reset(): void {
    this.entries.clear();
  }
}

const KEY_PREFIX = "viand:restaurants:";

/**
 * Shared cache over Redis.
 *
 * On a serverless host the process-local cache is close to useless: successive
 * messages from one group land on different instances, so nearly every search
 * is a miss and every miss is a live query against a volunteer-run Overpass
 * mirror that regularly refuses heavy requests. Sharing the cache turns a
 * repeated search into one upstream call for everyone, which is both faster
 * and the difference between a demo that works and one that times out.
 *
 * Failures are swallowed on purpose — see `RestaurantCacheBackend`. This is the
 * opposite of the session store, which propagates: a lost session produces
 * contradictory state, while a lost cache entry only produces a slower search.
 */
export class RedisCacheBackend implements RestaurantCacheBackend {
  constructor(
    private readonly transport: RedisTransport,
    private readonly onError: (error: unknown) => void = (error) =>
      logDegradation("restaurant_cache_unavailable", {}, error),
  ) {}

  async read(key: string): Promise<CacheEntry | null> {
    try {
      const raw = await this.transport.get(KEY_PREFIX + key);
      return raw === null ? null : (JSON.parse(raw) as CacheEntry);
    } catch (error) {
      this.onError(error);
      return null;
    }
  }

  async write(key: string, entry: CacheEntry, ttlMs: number): Promise<void> {
    try {
      await this.transport.set(
        KEY_PREFIX + key,
        JSON.stringify(entry),
        Math.max(1, Math.round(ttlMs / 1000)),
      );
    } catch (error) {
      this.onError(error);
    }
  }
}
