import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import type { RestaurantProvider } from "@/domain/restaurants/provider";
import { getEnv } from "../env";
import { GooglePlacesRestaurantProvider } from "./google-places-provider";

let mockSingleton: MockRestaurantProvider | null = null;

export function getMockRestaurantProvider(): MockRestaurantProvider {
  mockSingleton ??= new MockRestaurantProvider();
  return mockSingleton;
}

/**
 * The provider the live webhook path should use. Mirrors the messaging seam:
 * the mock is the default so the app runs with no credentials, and the real
 * provider is only constructed once it has been explicitly switched on.
 */
export function getRestaurantProvider(): RestaurantProvider {
  const env = getEnv();
  if (env.USE_MOCK_RESTAURANTS || !env.GOOGLE_MAPS_API_KEY) {
    return getMockRestaurantProvider();
  }
  return new GooglePlacesRestaurantProvider({
    apiKey: env.GOOGLE_MAPS_API_KEY,
    timeoutMs: env.GOOGLE_PLACES_TIMEOUT_MS,
  });
}
