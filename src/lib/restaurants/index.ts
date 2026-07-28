import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import type { RestaurantProvider } from "@/domain/restaurants/provider";
import { getEnv } from "../env";
import { CachedRestaurantProvider } from "./cached-provider";
import { OsmRestaurantProvider } from "./osm-provider";

let mockSingleton: MockRestaurantProvider | null = null;

export function getMockRestaurantProvider(): MockRestaurantProvider {
  mockSingleton ??= new MockRestaurantProvider();
  return mockSingleton;
}

/**
 * OpenStreetMap is the live source. Its public endpoints are keyless but
 * volunteer-run and capacity-constrained, so callers cache results and should
 * use paid or self-hosted endpoints for sustained production traffic.
 * `FallbackRestaurantProvider` stays in the tree unused as the composition
 * point for a future second source.
 */
export function getRestaurantProvider(): RestaurantProvider {
  const env = getEnv();
  if (env.USE_MOCK_RESTAURANTS) return getMockRestaurantProvider();

  // The cache wraps the source rather than living inside it, so the provider
  // stays a plain "ask the internet" object and the caching policy — including
  // serving stale data through an outage — is one reviewable thing.
  return new CachedRestaurantProvider(
    new OsmRestaurantProvider({
      overpassUrl: env.OVERPASS_URL,
      nominatimUrl: env.NOMINATIM_URL,
      userAgent: env.OSM_USER_AGENT,
      geocodingTimeoutMs: env.NOMINATIM_TIMEOUT_MS,
      timeoutMs: env.OSM_TIMEOUT_MS,
      maxQueryRadiusMetres: env.OSM_MAX_QUERY_RADIUS_METRES,
    }),
    { ttlMs: env.RESTAURANT_CACHE_TTL_HOURS * 60 * 60 * 1000 },
  );
}
