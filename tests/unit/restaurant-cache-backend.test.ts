import { describe, expect, it } from "vitest";
import type { RestaurantSearchResult } from "@/domain/restaurants/provider";
import { MemoryCacheBackend, RedisCacheBackend } from "@/lib/restaurants/cache-backend";
import { CachedRestaurantProvider } from "@/lib/restaurants/cached-provider";
import type { RedisTransport } from "@/lib/store/redis-transport";
import { restaurant } from "../helpers/factories";

function result(label: string): RestaurantSearchResult {
  return {
    restaurants: [restaurant({ id: `${label}-1` })],
    source: "osm",
    sourceLabel: label,
    resolvedLocation: null,
  };
}

function fakeRedis(overrides: Partial<RedisTransport> = {}) {
  const values = new Map<string, string>();
  const transport: RedisTransport = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    setIfNotExists: async () => true,
    del: async (key) => void values.delete(key),
    ...overrides,
  };
  return { transport, values };
}

const search = { locationText: "Boston", radiusMiles: 5, now: new Date("2026-08-18T12:00:00Z") };

describe("shared restaurant cache", () => {
  it("serves a second instance from the first instance's entry", async () => {
    // The property that matters on serverless: consecutive messages from one
    // group land on different processes, so the cache has to outlive the one
    // that filled it.
    const { transport } = fakeRedis();
    let calls = 0;
    const inner = { search: async () => (calls += 1, result("live")) };

    const first = new CachedRestaurantProvider(inner, { backend: new RedisCacheBackend(transport) });
    const second = new CachedRestaurantProvider(inner, { backend: new RedisCacheBackend(transport) });

    await first.search(search);
    const served = await second.search(search);

    expect(calls).toBe(1);
    expect(served.sourceLabel).toBe("live");
  });

  it("treats a cache outage as a miss rather than an error", async () => {
    // A cache is not a store. Losing it costs a slow search; propagating the
    // failure would cost the group their answer entirely.
    const { transport } = fakeRedis({
      get: async () => { throw new Error("redis down"); },
      set: async () => { throw new Error("redis down"); },
    });
    const inner = { search: async () => result("live") };
    const provider = new CachedRestaurantProvider(inner, {
      backend: new RedisCacheBackend(transport, () => {}),
    });

    await expect(provider.search(search)).resolves.toMatchObject({ sourceLabel: "live" });
  });

  it("still serves a stale shared entry when upstream fails", async () => {
    const { transport } = fakeRedis();
    let fail = false;
    const inner = {
      search: async () => {
        if (fail) throw new Error("overpass down");
        return result("live");
      },
    };
    const provider = new CachedRestaurantProvider(inner, {
      backend: new RedisCacheBackend(transport),
      onStale: () => {},
    });

    await provider.search(search);
    fail = true;
    const later = { ...search, now: new Date("2026-08-18T15:00:00Z") };

    await expect(provider.search(later)).resolves.toMatchObject({ sourceLabel: "live" });
  });

  it("keeps the process-local backend working with no external service", async () => {
    let calls = 0;
    const inner = { search: async () => (calls += 1, result("live")) };
    const provider = new CachedRestaurantProvider(inner, { backend: new MemoryCacheBackend() });

    await provider.search(search);
    await provider.search(search);

    expect(calls).toBe(1);
  });
});
