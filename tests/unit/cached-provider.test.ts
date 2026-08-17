import { describe, expect, it } from "vitest";
import type {
  RestaurantProvider,
  RestaurantSearchResult,
} from "@/domain/restaurants/provider";
import { CachedRestaurantProvider } from "@/lib/restaurants/cached-provider";
import { restaurant } from "../helpers/factories";

function result(label: string, count = 2): RestaurantSearchResult {
  return {
    restaurants: Array.from({ length: count }, (_, i) => restaurant({ id: `${label}-${i}` })),
    source: "osm",
    sourceLabel: label,
    resolvedLocation: null,
  };
}

/** Counts calls and can be switched to failing partway through a test. */
function source() {
  const state = { calls: 0, fail: false, label: "fresh" };
  const provider: RestaurantProvider = {
    search: async () => {
      state.calls += 1;
      if (state.fail) throw new Error("Overpass search failed with status 504.");
      return result(state.label);
    },
  };
  return { provider, state };
}

const input = {
  locationText: "Downtown Berkeley",
  radiusMiles: 5,
  now: new Date("2024-01-01T12:00:00Z"),
};
const silent = () => {};

describe("CachedRestaurantProvider", () => {
  it("only hits the source once for a repeated search", async () => {
    const { provider, state } = source();
    const cached = new CachedRestaurantProvider(provider, { onStale: silent });

    await cached.search(input);
    await cached.search(input);
    await cached.search({ ...input, locationText: "  downtown   BERKELEY " });

    // Whitespace and case differences are the same neighbourhood.
    expect(state.calls).toBe(1);
  });

  it("coalesces concurrent searches for the same key", async () => {
    const state = { calls: 0 };
    const delayed: RestaurantProvider = {
      search: async () => {
        state.calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
        return result("shared");
      },
    };
    const cached = new CachedRestaurantProvider(delayed, { onStale: silent });

    const [first, second] = await Promise.all([cached.search(input), cached.search(input)]);

    expect(state.calls).toBe(1);
    expect(first.restaurants).toHaveLength(2);
    expect(second.restaurants).toHaveLength(2);
  });

  it("reuses cache entries for nearby shared locations", async () => {
    const { provider, state } = source();
    const cached = new CachedRestaurantProvider(provider, { onStale: silent });

    await cached.search({ ...input, locationText: "37.8715,-122.2730" });
    await cached.search({ ...input, locationText: "37.8720,-122.2735" });

    expect(state.calls).toBe(1);
  });

  it("does not reuse cache entries for distant shared locations", async () => {
    const { provider, state } = source();
    const cached = new CachedRestaurantProvider(provider, { onStale: silent });

    await cached.search({ ...input, locationText: "37.8715,-122.2730" });
    await cached.search({ ...input, locationText: "37.9500,-122.3500" });

    expect(state.calls).toBe(2);
  });

  it("treats a different radius as a different search", async () => {
    const { provider, state } = source();
    const cached = new CachedRestaurantProvider(provider, { onStale: silent });

    await cached.search(input);
    await cached.search({ ...input, radiusMiles: 2 });

    expect(state.calls).toBe(2);
  });

  it("re-fetches once the entry is older than the TTL", async () => {
    const { provider, state } = source();
    let now = 0;
    const cached = new CachedRestaurantProvider(provider, {
      ttlMs: 1_000,
      now: () => now,
      onStale: silent,
    });

    await cached.search(input);
    now = 5_000;
    await cached.search(input);

    expect(state.calls).toBe(2);
  });

  it("serves a stale result when the source is down", async () => {
    const { provider, state } = source();
    let now = 0;
    const stale: number[] = [];
    const cached = new CachedRestaurantProvider(provider, {
      ttlMs: 1_000,
      now: () => now,
      onStale: (_error, ageMs) => stale.push(ageMs),
    });

    await cached.search(input);
    now = 60_000;
    state.fail = true;

    // The group gets restaurants rather than "couldn't reach the listings".
    const served = await cached.search(input);
    expect(served.restaurants).toHaveLength(2);
    expect(stale).toEqual([60_000]);
  });

  it("still fails when the source is down and nothing was cached", async () => {
    const { provider, state } = source();
    state.fail = true;
    const cached = new CachedRestaurantProvider(provider, { onStale: silent });

    // Nothing to fall back on, so the retryable message is still the right answer.
    await expect(cached.search(input)).rejects.toThrow("504");
  });

  it("does not cache an empty result", async () => {
    const empty: RestaurantProvider = { search: async () => result("empty", 0) };
    let calls = 0;
    const counting: RestaurantProvider = {
      search: async (i) => {
        calls += 1;
        return empty.search(i);
      },
    };
    const cached = new CachedRestaurantProvider(counting, { onStale: silent });

    await cached.search(input);
    await cached.search(input);

    // Caching "nothing here" would pin a bad lookup in place for a week.
    expect(calls).toBe(2);
  });

  it("evicts the oldest entry once full", async () => {
    const { provider, state } = source();
    const cached = new CachedRestaurantProvider(provider, { maxEntries: 2, onStale: silent });

    await cached.search({ ...input, locationText: "a" });
    await cached.search({ ...input, locationText: "b" });
    await cached.search({ ...input, locationText: "c" });
    const before = state.calls;

    await cached.search({ ...input, locationText: "a" });
    expect(state.calls).toBe(before + 1);
  });
});

describe("time sensitivity of cached hours", () => {
  const HOUR = 60 * 60 * 1000;
  const base = new Date("2026-08-17T12:00:00Z");
  const search = (now: Date) => ({ locationText: "Berkeley", radiusMiles: 5, now });

  it("refetches once the hour changes, because openNow was computed then", () => {
    const { provider: inner, state } = source();
    const cache = new CachedRestaurantProvider(inner, { now: () => base.getTime() });

    return (async () => {
      await cache.search(search(base));
      await cache.search(search(new Date(base.getTime() + 5 * 60 * 1000)));
      expect(state.calls).toBe(1); // same hour, still fresh

      await cache.search(search(new Date(base.getTime() + HOUR)));
      // A lunchtime result must not be served back at dinner with its
      // dinner-only restaurants already filtered out.
      expect(state.calls).toBe(2);
    })();
  });

  it("still serves a previous hour's result when upstream fails", async () => {
    const { provider: inner, state } = source();
    const cache = new CachedRestaurantProvider(inner, {
      now: () => base.getTime(),
      onStale: () => {},
    });

    await cache.search(search(base));
    state.fail = true;

    // The entry is an hour old and therefore not fresh, but an outage must
    // degrade to slightly stale hours rather than to no options at all.
    const result = await cache.search(search(new Date(base.getTime() + HOUR)));
    expect(result.restaurants.length).toBeGreaterThan(0);
  });
});
