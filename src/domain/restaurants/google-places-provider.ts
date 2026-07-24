import {
  RestaurantProviderNotConfiguredError,
  type Restaurant,
  type RestaurantProvider,
  type RestaurantSearchInput,
} from "./provider";

/**
 * Phase 2 placeholder. Deliberately fails loudly rather than silently falling
 * back to mock data, so a misconfigured deploy cannot ship fake restaurants to
 * real users. Replacing this class is the entire Google Places integration:
 * nothing else in the domain knows where restaurants come from.
 */
export class GooglePlacesRestaurantProvider implements RestaurantProvider {
  async search(_input: RestaurantSearchInput): Promise<Restaurant[]> {
    throw new RestaurantProviderNotConfiguredError(
      "GooglePlacesRestaurantProvider",
      "Google Places is not part of phase 1. Set USE_MOCK_RESTAURANTS=true to use " +
        "MockRestaurantProvider, or implement this provider against the Places API.",
    );
  }
}
