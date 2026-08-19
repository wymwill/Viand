import { logDegradation } from "../observability/log";
import type {
  RestaurantProvider,
  RestaurantSearchInput,
  RestaurantSearchResult,
} from "@/domain/restaurants/provider";

/**
 * Tries one source and falls back to another.
 *
 * "Failure" deliberately includes an empty result, not just a thrown error: a
 * source that is reachable but has no listings for this neighbourhood has not
 * answered the group's question, and the whole point of a second source is to
 * cover that. An empty-but-successful primary result is still kept as a
 * last resort, so a fallback that also comes up dry cannot turn a legitimate
 * "nothing here" into an exception.
 *
 * When both sources fail the error propagates, which the state machine turns
 * into a retryable "couldn't reach the listings" message rather than a crash.
 */
export class FallbackRestaurantProvider implements RestaurantProvider {
  constructor(
    private readonly primary: RestaurantProvider,
    private readonly fallback: RestaurantProvider,
    /** Injected in tests; defaults to one warn line so silent failover is visible. */
    private readonly onFallback: (error: unknown) => void = (error) =>
      logDegradation("restaurant_source_failover", {}, error),
  ) {}

  async search(input: RestaurantSearchInput): Promise<RestaurantSearchResult> {
    let primaryEmpty: RestaurantSearchResult | null = null;

    try {
      const result = await this.primary.search(input);
      if (result.restaurants.length > 0) return result;
      primaryEmpty = result;
    } catch (error) {
      this.onFallback(error);
    }

    try {
      const result = await this.fallback.search(input);
      if (result.restaurants.length > 0 || primaryEmpty == null) return result;
      return primaryEmpty;
    } catch (error) {
      if (primaryEmpty) return primaryEmpty;
      throw error;
    }
  }
}
