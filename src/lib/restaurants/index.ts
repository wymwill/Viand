import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import type { RestaurantProvider } from "@/domain/restaurants/provider";
import { getEnv } from "../env";
import { OsmRestaurantProvider } from "./osm-provider";

let mockSingleton: MockRestaurantProvider | null = null;

export function getMockRestaurantProvider(): MockRestaurantProvider {
  mockSingleton ??= new MockRestaurantProvider();
  return mockSingleton;
}

/**
 * OpenStreetMap is the live source: free, keyless, and unmetered, which is the
 * whole reason it won over the commercial APIs. `FallbackRestaurantProvider`
 * stays in the tree unused — it is the composition point for a second source
 * (ratings, most likely) whenever one is added.
 */
export function getRestaurantProvider(): RestaurantProvider {
  const env = getEnv();
  if (env.USE_MOCK_RESTAURANTS) return getMockRestaurantProvider();

  return new OsmRestaurantProvider({
    overpassUrl: env.OVERPASS_URL,
    nominatimUrl: env.NOMINATIM_URL,
    userAgent: env.OSM_USER_AGENT,
    timeoutMs: env.OSM_TIMEOUT_MS,
  });
}
