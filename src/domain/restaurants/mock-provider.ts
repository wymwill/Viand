import { MOCK_RESTAURANTS } from "./mock-data";
import type { Restaurant, RestaurantProvider, RestaurantSearchInput } from "./provider";

/**
 * Returns the fixed catalogue, filtered only by the coarse search parameters.
 * `locationText` is intentionally ignored: phase 1 does no geocoding, so every
 * search returns the same neighbourhood and results stay deterministic for
 * tests. Per-member restrictions are applied later by the recommendation
 * engine, not here — the provider's job is to supply candidates, not to judge
 * them.
 */
export class MockRestaurantProvider implements RestaurantProvider {
  constructor(private readonly catalogue: readonly Restaurant[] = MOCK_RESTAURANTS) {}

  async search(input: RestaurantSearchInput): Promise<Restaurant[]> {
    const results = this.catalogue.filter((candidate) => {
      if (candidate.distanceMiles > input.radiusMiles) return false;
      if (input.maxPriceLevel != null && candidate.priceLevel > input.maxPriceLevel) return false;
      if (input.openNowOnly && !candidate.openNow) return false;
      return true;
    });

    // Stable ordering so downstream ranking is reproducible regardless of the
    // catalogue's declaration order.
    return results.sort((a, b) => a.id.localeCompare(b.id));
  }
}
