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

const input = { locationText: "Downtown Berkeley", radiusMiles: 5 };
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
