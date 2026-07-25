import { describe, expect, it } from "vitest";
import {
  GooglePlacesRestaurantProvider,
  distanceMiles,
  parseSharedLocation,
} from "@/lib/restaurants/google-places-provider";

const BERKELEY = { latitude: 37.8715, longitude: -122.273 };

function place(overrides: Record<string, unknown> = {}) {
  return {
    id: "place-1",
    displayName: { text: "Taqueria Uno" },
    formattedAddress: "1 Shattuck Ave, Berkeley, CA",
    location: { latitude: 37.872, longitude: -122.2735 },
    rating: 4.5,
    priceLevel: "PRICE_LEVEL_INEXPENSIVE",
    primaryType: "mexican_restaurant",
    types: ["mexican_restaurant", "restaurant", "food"],
    currentOpeningHours: { openNow: true },
    googleMapsUri: "https://maps.google.com/?cid=1",
    servesVegetarianFood: true,
    ...overrides,
  };
}

/** Serves a fixed geocode result and a fixed nearby-search result. */
function stubFetch(places: unknown[], onGeocode?: () => void) {
  return (async (target: RequestInfo | URL) => {
    const url = String(target instanceof Request ? target.url : target);

    if (url.includes("/maps/api/geocode")) {
      onGeocode?.();
      return new Response(
        JSON.stringify({
          status: "OK",
          results: [
            {
              formatted_address: "Downtown Berkeley, CA",
              geometry: { location: { lat: BERKELEY.latitude, lng: BERKELEY.longitude } },
            },
          ],
        }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ places }), { status: 200 });
  }) as unknown as typeof fetch;
}

function provider(places: unknown[], onGeocode?: () => void) {
  return new GooglePlacesRestaurantProvider({
    apiKey: "test-key",
    fetchImpl: stubFetch(places, onGeocode),
  });
}

describe("parseSharedLocation", () => {
  it("reads a bare coordinate pair", () => {
    expect(parseSharedLocation("37.8715, -122.2730")).toEqual({
      latitude: 37.8715,
      longitude: -122.273,
    });
  });

  it("reads coordinates out of a shared map link", () => {
    expect(parseSharedLocation("https://maps.apple.com/?ll=37.8715,-122.2730&q=Here")).toEqual({
      latitude: 37.8715,
      longitude: -122.273,
    });
    expect(parseSharedLocation("https://www.google.com/maps/@37.8715,-122.2730,15z")).toEqual({
      latitude: 37.8715,
      longitude: -122.273,
    });
  });

  it("rejects text that is not a location", () => {
    expect(parseSharedLocation("Downtown Berkeley")).toBeNull();
    expect(parseSharedLocation("94110")).toBeNull();
    expect(parseSharedLocation("999, 999")).toBeNull();
  });
});

describe("distanceMiles", () => {
  it("measures a short hop", () => {
    const near = distanceMiles(BERKELEY, { latitude: 37.872, longitude: -122.2735 });
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(0.1);
  });

  it("measures a known long distance", () => {
    // Berkeley to Los Angeles is roughly 340 miles.
    const far = distanceMiles(BERKELEY, { latitude: 34.0522, longitude: -118.2437 });
    expect(far).toBeGreaterThan(320);
    expect(far).toBeLessThan(360);
  });
});

describe("GooglePlacesRestaurantProvider", () => {
  it("geocodes typed text and identifies the source", async () => {
    const result = await provider([place()]).search({
      locationText: "Downtown Berkeley",
      radiusMiles: 5,
    });

    expect(result.source).toBe("google_places");
    expect(result.sourceLabel).toContain("Google Places");
    expect(result.resolvedLocation).toBe("Downtown Berkeley, CA");
  });

  it("uses a shared location without spending a geocoding call", async () => {
    let geocoded = false;
    const result = await provider([place()], () => {
      geocoded = true;
    }).search({ locationText: "37.8715,-122.2730", radiusMiles: 5 });

    expect(geocoded).toBe(false);
    expect(result.restaurants).toHaveLength(1);
  });

  it("normalises rating, price, cuisine, distance, opening status and map url", async () => {
    const result = await provider([place()]).search({
      locationText: "Downtown Berkeley",
      radiusMiles: 5,
    });

    const restaurant = result.restaurants[0];
    expect(restaurant).toMatchObject({
      id: "place-1",
      name: "Taqueria Uno",
      cuisine: "mexican",
      priceLevel: 1,
      rating: 4.5,
      openNow: true,
      mapsUrl: "https://maps.google.com/?cid=1",
      accommodates: ["vegetarian"],
    });
    expect(restaurant?.distanceMiles).toBeLessThan(0.1);
  });

  it("labels an unmapped category rather than guessing a cuisine", async () => {
    const result = await provider([
      place({ primaryType: "peruvian_restaurant", types: ["peruvian_restaurant", "restaurant"] }),
    ]).search({ locationText: "Downtown Berkeley", radiusMiles: 5 });

    expect(result.restaurants[0]?.cuisine).toBe("other");
  });

  it("fills in defaults for missing price, rating and opening status", async () => {
    const result = await provider([
      place({ priceLevel: undefined, rating: undefined, currentOpeningHours: undefined }),
    ]).search({ locationText: "Downtown Berkeley", radiusMiles: 5 });

    expect(result.restaurants[0]).toMatchObject({ priceLevel: 2, rating: 0, openNow: true });
  });

  it("claims no dietary capability Google did not report", async () => {
    const result = await provider([place({ servesVegetarianFood: false })]).search({
      locationText: "Downtown Berkeley",
      radiusMiles: 5,
    });

    expect(result.restaurants[0]?.accommodates).toEqual([]);
  });

  it("gives branches of one brand a shared chain id", async () => {
    const result = await provider([
      place({ id: "a", displayName: { text: "Taqueria Uno" } }),
      place({ id: "b", displayName: { text: "Taqueria Uno" } }),
      place({ id: "c", displayName: { text: "Pizza Pi" } }),
    ]).search({ locationText: "Downtown Berkeley", radiusMiles: 5 });

    const [first, second, third] = result.restaurants;
    expect(first?.chainId).toBe(second?.chainId);
    expect(third?.chainId).not.toBe(first?.chainId);
  });

  it("drops places beyond the requested radius and listings too sparse to show", async () => {
    const result = await provider([
      place(),
      place({ id: "far", location: { latitude: 34.0522, longitude: -118.2437 } }),
      place({ id: undefined }),
      place({ id: "nameless", displayName: undefined }),
    ]).search({ locationText: "Downtown Berkeley", radiusMiles: 5 });

    expect(result.restaurants.map((restaurant) => restaurant.id)).toEqual(["place-1"]);
  });
});
