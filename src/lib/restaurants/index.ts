import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import type { RestaurantProvider } from "@/domain/restaurants/provider";
import { getEnv } from "../env";
import { logDegradation } from "../observability/log";
import { RedisCacheBackend, type RestaurantCacheBackend } from "./cache-backend";
import { CachedRestaurantProvider } from "./cached-provider";
import { UpstashRestTransport } from "../store/redis-transport";
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
    {
      ttlMs: env.RESTAURANT_CACHE_TTL_HOURS * 60 * 60 * 1000,
      backend: restaurantCacheBackend(),
    },
  );
}

/**
 * A shared cache when Redis is configured, otherwise the process-local one.
 *
 * This matters most on serverless. Successive messages from one group land on
 * different instances, so a process-local cache misses almost every time and
 * each miss is a live query against a volunteer-run Overpass mirror. Sharing it
 * turns a repeated search into one upstream call for everybody.
 *
 * Falling back to memory rather than failing is deliberate: unlike the session
 * store, where partial state is worse than a delay, a missing cache costs only
 * a slower search.
 */
function restaurantCacheBackend(): RestaurantCacheBackend | undefined {
  const env = getEnv();
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return undefined;
  try {
    return new RedisCacheBackend(new UpstashRestTransport());
  } catch (error) {
    logDegradation("restaurant_cache_unavailable", { backend: "memory" }, error);
    return undefined;
  }
}
