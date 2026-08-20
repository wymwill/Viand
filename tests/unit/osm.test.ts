import { describe, expect, it } from "vitest";
import { OSM_SOURCE_LABEL } from "@/domain/restaurants/provider";
import { OsmRestaurantProvider, shortLocationLabel } from "@/lib/restaurants/osm-provider";

const CENTER = { lat: 37.8715, lon: -122.273 };

/**
 * Distinct id means a distinct place. The provider now collapses the same
 * restaurant entered twice, so a fixture of identically named nodes at one
 * coordinate would be deduplicated to a single result — which is correct
 * behaviour and a meaningless test.
 */
function node(overrides: Record<string, unknown> = {}) {
  const { tags, ...rest } = overrides as { tags?: Record<string, string> };
  const id = typeof rest.id === "number" ? rest.id : 1;
  return {
    type: "node",
    id: 1,
    // Roughly 110 metres apart per id, comfortably outside the "same place"
    // radius without leaving the search radius.
    lat: 37.872 + id * 0.001,
    lon: -122.2735,
    tags: {
      name: id === 1 ? "Tacoria" : `Tacoria ${id}`,
      amenity: "restaurant",
      cuisine: "mexican",
      ...tags,
    },
    ...rest,
  };
}

let lastQuery = "";

function stubFetch(elements: unknown[], onGeocode?: () => void) {
  return (async (target: RequestInfo | URL, init?: RequestInit) => {
    const url = String(target instanceof Request ? target.url : target);
    if (!url.includes("nominatim")) {
      lastQuery = decodeURIComponent(String(init?.body ?? ""));
    }
    if (url.includes("nominatim")) {
      onGeocode?.();
      return new Response(
        JSON.stringify([
          { lat: String(CENTER.lat), lon: String(CENTER.lon), display_name: "Berkeley, California" },
        ]),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ elements }), { status: 200 });
  }) as unknown as typeof fetch;
}

const search = {
  locationText: "Berkeley",
  radiusMiles: 5,
  now: new Date("2024-01-01T12:00:00Z"),
};

function provider(elements: unknown[], onGeocode?: () => void) {
  return new OsmRestaurantProvider({ fetchImpl: stubFetch(elements, onGeocode) });
}

describe("shortLocationLabel", () => {
  it("keeps only the leading component of a Nominatim hierarchy", () => {
    expect(
      shortLocationLabel(
        "Downtown Berkeley, 2160, Shattuck Avenue, Berkeley, Alameda County, California, 94704, United States",
      ),
    ).toBe("Downtown Berkeley");
  });

  it("keeps the street when the first component is a house number", () => {
    expect(shortLocationLabel("2160, Shattuck Avenue, Berkeley, California")).toBe(
      "2160 Shattuck Avenue",
    );
  });
});

describe("Overpass endpoint failover", () => {
  it("moves to the next endpoint when one is overloaded", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("nominatim")) return stubFetch([node()])(target as RequestInfo, init);
      tried.push(url);
      // First endpoint is saturated, second answers.
      if (tried.length === 1) return new Response("", { status: 504 });
      return new Response(
        JSON.stringify({ elements: Array.from({ length: 12 }, (_, id) => node({ id })) }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await new OsmRestaurantProvider({
      fetchImpl,
      overpassUrl: "https://a.example/api,https://b.example/api",
    }).search(search);

    // Failover costs one query per endpoint at the requested radius; the
    // second endpoint answers, so no close-in retry is needed.
    expect(tried).toHaveLength(2);
    expect(result.restaurants).toHaveLength(12);
  });

  it("does not let a hanging primary block a healthy fallback", async () => {
    const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("nominatim")) return stubFetch([node()])(target as RequestInfo, init);
      if (url.includes("a.example")) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }) as Promise<Response>;
      }
      return new Response(JSON.stringify({ elements: [node()] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await new OsmRestaurantProvider({
      fetchImpl,
      timeoutMs: 5_000,
      overpassUrl: ["https://a.example/api", "https://b.example/api"],
    }).search(search);

    expect(result.restaurants).toHaveLength(1);
  });

  it("bounds total failover time rather than multiplying it", async () => {
    // Every endpoint hangs. Each attempt must get a slice of the budget, so the
    // whole thing finishes near timeoutMs rather than timeoutMs × endpoints.
    const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("nominatim")) return stubFetch([node()])(target as RequestInfo, init);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }) as Promise<Response>;
    }) as unknown as typeof fetch;

    const started = Date.now();
    await expect(
      new OsmRestaurantProvider({
        fetchImpl,
        timeoutMs: 300,
        overpassUrl: ["https://a.example/api", "https://b.example/api", "https://c.example/api"],
      }).search(search),
    ).rejects.toThrow();

    expect(Date.now() - started).toBeLessThan(1_500);
  }, 3_000);

  it("reports the last failure when every endpoint is down", async () => {
    const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("nominatim")) return stubFetch([node()])(target as RequestInfo, init);
      return new Response("", { status: 504 });
    }) as unknown as typeof fetch;

    await expect(
      new OsmRestaurantProvider({
        fetchImpl,
        overpassUrl: ["https://a.example/api", "https://b.example/api"],
      }).search(search),
    ).rejects.toThrow(
      "All Overpass endpoints failed (a.example: Overpass search failed with status 504.; b.example: Overpass search failed with status 504.)",
    );
  });

  it("identifies Overpass timeouts by endpoint", async () => {
    const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("nominatim")) return stubFetch([node()])(target as RequestInfo, init);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;

    await expect(
      new OsmRestaurantProvider({
        fetchImpl,
        timeoutMs: 5_000,
        overpassUrl: "https://overpass.example/api",
      }).search(search),
    ).rejects.toThrow("overpass.example: timed out after");
  });
});

describe("Overpass query cost", () => {
  it("searches the radius the group actually asked for", async () => {
    const queries: string[] = [];
    const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("nominatim")) return stubFetch([])(target as RequestInfo, init);
      queries.push(decodeURIComponent(String(init?.body ?? "")));
      return new Response(JSON.stringify({ elements: [node()] }), { status: 200 });
    }) as unknown as typeof fetch;

    await new OsmRestaurantProvider({ fetchImpl, overpassUrl: "https://a.example/api" }).search({
      locationText: "Berkeley",
      radiusMiles: 5,
      now: new Date(),
    });

    // One query, at the requested radius. A cheap close-in pass used to run
    // first and, in a dense area, stop there — silently turning a five mile
    // request into a 0.93 mile one.
    expect(queries.map((query) => Number(/around:(\d+)/.exec(query)?.[1]))).toEqual([8047]);
  });

  it("does not narrow the search just because the close-in area is busy", async () => {
    const radii: number[] = [];
    const elements = Array.from({ length: 40 }, (_, id) => node({ id: id + 1 }));
    const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("nominatim")) return stubFetch([])(target as RequestInfo, init);
      const query = decodeURIComponent(String(init?.body ?? ""));
      radii.push(Number(/around:(\d+)/.exec(query)?.[1]));
      return new Response(JSON.stringify({ elements }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await new OsmRestaurantProvider({
      fetchImpl,
      overpassUrl: "https://a.example/api",
    }).search(search);

    expect(radii).toEqual([8047]);
    expect(result.sourceLabel).toBe(OSM_SOURCE_LABEL);
  });

  it("falls back to a close-in search and says so when the full radius fails", async () => {
    let overpassCalls = 0;
    const radii: number[] = [];
    const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("nominatim")) return stubFetch([])(target as RequestInfo, init);
      overpassCalls += 1;
      const query = decodeURIComponent(String(init?.body ?? ""));
      radii.push(Number(/around:(\d+)/.exec(query)?.[1]));
      // Every endpoint fails at the full radius; the narrow retry succeeds.
      if (radii.at(-1) === 8047) return new Response("", { status: 504 });
      return new Response(JSON.stringify({ elements: [node({ id: 1 }), node({ id: 2 })] }));
    }) as unknown as typeof fetch;

    const result = await new OsmRestaurantProvider({
      fetchImpl,
      overpassUrl: ["https://a.example/api", "https://b.example/api"],
    }).search(search);

    expect(result.restaurants).toHaveLength(2);
    // A narrower search is never presented as a complete one.
    expect(result.sourceLabel).toContain("0.9 mi");
    expect(result.sourceLabel).toContain("full 5 mi radius could not be reached");
    expect(overpassCalls).toBeGreaterThan(1);
  });

  it("throws when the close-in fallback also finds nothing", async () => {
    const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("nominatim")) return stubFetch([])(target as RequestInfo, init);
      const query = decodeURIComponent(String(init?.body ?? ""));
      const radius = Number(/around:(\d+)/.exec(query)?.[1]);
      if (radius === 8047) return new Response("", { status: 504 });
      return new Response(JSON.stringify({ elements: [] }));
    }) as unknown as typeof fetch;

    await expect(
      new OsmRestaurantProvider({
        fetchImpl,
        overpassUrl: ["https://a.example/api", "https://b.example/api"],
      }).search(search),
    ).rejects.toThrow("All Overpass endpoints failed");
  });


  it("never asks for more than the group's radius", async () => {
    await provider([node()]).search({
      locationText: "Berkeley",
      radiusMiles: 0.5,
      now: new Date(),
    });
    const around = /around:(\d+)/.exec(lastQuery);
    expect(Number(around?.[1])).toBeLessThan(1000);
  });

  it("covers polygons, and widens the amenity set only when the radius is small", async () => {
    // A close-in search can afford several spatial passes.
    await provider([node()]).search({ ...search, radiusMiles: 0.5 });
    expect(lastQuery).not.toContain("~");
    expect(lastQuery).toContain('nwr["amenity"="restaurant"]');
    expect(lastQuery).toContain('nwr["amenity"="cafe"]');
    expect(lastQuery).toContain('nwr["amenity"="pub"]');
    // Nodes alone missed every restaurant mapped as a building outline.
    expect(lastQuery).not.toContain('node["amenity"');
  });

  it("asks only for restaurants once the radius is wide", async () => {
    // Measured against a public mirror over central Boston at five miles: one
    // clause answered in 2.7s, two took 38s, three or more returned 504. The
    // extra clauses are what made a wide search collapse back to a one mile
    // result, so a wide search spends its budget on restaurants alone.
    await provider([node()]).search(search);
    expect(lastQuery).toContain('nwr["amenity"="restaurant"]');
    expect(lastQuery).not.toContain('"amenity"="cafe"');
    expect(lastQuery).not.toContain('"amenity"="pub"');
  });


  it("gives Overpass generous time regardless of our own budget", async () => {
    // Tying this to our budget once set it to 3s, at which point Overpass
    // returned an empty result with a remark and the group was told there was
    // nowhere to eat in central Berkeley.
    await new OsmRestaurantProvider({
      fetchImpl: stubFetch([node()]),
      timeoutMs: 4_000,
      overpassUrl: "https://a.example/api,https://b.example/api",
    }).search(search);
    expect(lastQuery).toContain("[timeout:40]");
  });

  it("treats a remark as a failure rather than an empty neighbourhood", async () => {
    const fetchImpl = (async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (url.includes("nominatim")) return stubFetch([node()])(target as RequestInfo, init);
      return new Response(
        JSON.stringify({ elements: [], remark: "runtime error: Query timed out" }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await expect(
      new OsmRestaurantProvider({ fetchImpl, overpassUrl: "https://a.example/api" }).search(search),
    ).rejects.toThrow("remark");
  });
});

describe("OsmRestaurantProvider", () => {
  it("identifies a geocoding timeout instead of blaming Overpass", async () => {
    const fetchImpl = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;

    await expect(
      new OsmRestaurantProvider({
        fetchImpl,
        geocodingTimeoutMs: 5_000,
      }).search(search),
    ).rejects.toThrow("Nominatim geocoding timed out after 5000ms");
  });

  it("normalises a listing and identifies the source", async () => {
    const result = await provider([node()]).search(search);

    expect(result.source).toBe("osm");
    expect(result.sourceLabel).toContain("OpenStreetMap");
    expect(result.resolvedLocation).toBe("Berkeley");
    expect(result.restaurants[0]).toMatchObject({
      id: "node/1",
      name: "Tacoria",
      cuisine: "mexican",
      // OSM publishes neither, so neither is claimed.
      rating: null,
      priceLevel: null,
      openNow: null,
      openingHoursRaw: null,
    });
  });

  it("reads the dietary tags commercial APIs do not publish", async () => {
    const result = await provider([
      node({ tags: { "diet:halal": "yes", "diet:gluten_free": "only", "diet:vegan": "yes" } }),
    ]).search(search);

    const accommodates = result.restaurants[0]?.accommodates ?? [];
    expect(accommodates).toContain("halal");
    expect(accommodates).toContain("gluten_free");
    expect(accommodates).toContain("vegan");
    // Vegan food is vegetarian food.
    expect(accommodates).toContain("vegetarian");
  });

  it("treats a 'limited' dietary tag as no claim at all", async () => {
    const result = await provider([
      node({ tags: { "diet:vegan": "limited", "diet:halal": "no" } }),
    ]).search(search);

    expect(result.restaurants[0]?.accommodates).toEqual([]);
  });

  it("labels an unmapped cuisine rather than guessing", async () => {
    const result = await provider([node({ tags: { cuisine: "peruvian" } })]).search(search);
    expect(result.restaurants[0]?.cuisine).toBe("other");
  });

  it("reads the first recognised entry of a multi-value cuisine tag", async () => {
    const result = await provider([node({ tags: { cuisine: "peruvian;pizza" } })]).search(search);
    expect(result.restaurants[0]?.cuisine).toBe("pizza");
  });

  it("handles way elements and skips unnamed ones", async () => {
    const result = await provider([
      { type: "way", id: 7, center: { lat: 37.8718, lon: -122.2732 }, tags: { name: "Green Fork" } },
      { type: "node", id: 8, lat: 37.8719, lon: -122.2733, tags: { amenity: "restaurant" } },
    ]).search(search);

    expect(result.restaurants.map((r) => r.id)).toEqual(["way/7"]);
  });

  it("uses a shared location without geocoding", async () => {
    let geocoded = false;
    const result = await provider([node()], () => {
      geocoded = true;
    }).search({ ...search, locationText: "37.8715,-122.2730" });

    expect(geocoded).toBe(false);
    expect(result.resolvedLocation).toBe("the shared location");
  });

  it("drops name-brand fast food and coffee chains", async () => {
    const result = await provider([
      node({ id: 1, tags: { name: "McDonald's", amenity: "fast_food", "brand:wikidata": "Q38076" } }),
      node({ id: 2, tags: { name: "Starbucks", amenity: "cafe", brand: "Starbucks" } }),
      node({ id: 3, tags: { name: "Taqueria Uno", amenity: "restaurant" } }),
    ]).search(search);

    expect(result.restaurants.map((r) => r.name)).toEqual(["Taqueria Uno"]);
  });

  it("keeps an unbranded counter-service place", async () => {
    // An unbranded fast_food is a taqueria or a food truck, not a chain, and is
    // exactly the kind of option worth offering.
    const result = await provider([
      node({ tags: { name: "El Gordo Taco Truck", amenity: "fast_food" } }),
    ]).search(search);

    expect(result.restaurants).toHaveLength(1);
  });

  it("keeps a branded sit-down restaurant", async () => {
    const result = await provider([
      node({ tags: { name: "Local Bistro Group", amenity: "restaurant", brand: "Local Bistro" } }),
    ]).search(search);

    expect(result.restaurants).toHaveLength(1);
  });

  it("uses the OSM brand id as the chain key when there is one", async () => {
    const result = await provider([
      node({ id: 1, lat: 37.8721, tags: { name: "Bistro Downtown", "brand:wikidata": "Q123" } }),
      node({ id: 2, lat: 37.8722, tags: { name: "Bistro Uptown", "brand:wikidata": "Q123" } }),
    ]).search(search);

    const [first, second] = result.restaurants;
    // Differently named branches still resolve to one chain, which name
    // matching alone could never work out.
    expect(first?.chainId).toBe("Q123");
    expect(second?.chainId).toBe("Q123");
  });

  it("scores a thoroughly tagged place above a bare one", async () => {
    const result = await provider([
      node({
        id: 1,
        tags: {
          name: "Well Documented",
          cuisine: "italian",
          website: "https://example.com",
          phone: "+1 510-555-0100",
          opening_hours: "Mo-Su 11:00-22:00",
          "addr:street": "College Ave",
        },
      }),
      node({ id: 2, tags: { name: "Bare Pin" } }),
    ]).search(search);

    const documented = result.restaurants.find((r) => r.name === "Well Documented");
    const bare = result.restaurants.find((r) => r.name === "Bare Pin");
    expect(documented?.completeness).toBe(1);
    // The bare pin still carries a cuisine tag from the factory default, so it
    // scores one signal out of five — the point is the gap, not the floor.
    expect(bare?.completeness).toBeCloseTo(0.2);
    expect(documented?.completeness ?? 0).toBeGreaterThan(bare?.completeness ?? 0);
    expect(documented?.website).toBe("https://example.com");
    expect(documented?.phone).toBe("+1 510-555-0100");
  });

  it("reads contact:-prefixed website and phone tags", async () => {
    const result = await provider([
      node({ tags: { "contact:website": "https://c.example", "contact:phone": "555" } }),
    ]).search(search);

    expect(result.restaurants[0]).toMatchObject({
      website: "https://c.example",
      phone: "555",
    });
  });

  it("drops listings beyond the requested radius", async () => {
    const result = await provider([
      node(),
      node({ id: 99, lat: 34.0522, lon: -118.2437 }),
    ]).search(search);

    expect(result.restaurants.map((r) => r.id)).toEqual(["node/1"]);
  });
});
