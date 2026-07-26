import { describe, expect, it } from "vitest";
import { OsmRestaurantProvider, shortLocationLabel } from "@/lib/restaurants/osm-provider";

const CENTER = { lat: 37.8715, lon: -122.273 };

function node(overrides: Record<string, unknown> = {}) {
  const { tags, ...rest } = overrides as { tags?: Record<string, string> };
  return {
    type: "node",
    id: 1,
    lat: 37.872,
    lon: -122.2735,
    tags: { name: "Tacoria", amenity: "restaurant", cuisine: "mexican", ...tags },
    ...rest,
  };
}

function stubFetch(elements: unknown[], onGeocode?: () => void) {
  return (async (target: RequestInfo | URL) => {
    const url = String(target instanceof Request ? target.url : target);
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

const search = { locationText: "Berkeley", radiusMiles: 5 };

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

describe("OsmRestaurantProvider", () => {
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
      rating: 0,
      priceLevel: 2,
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
    }).search({ locationText: "37.8715,-122.2730", radiusMiles: 5 });

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
