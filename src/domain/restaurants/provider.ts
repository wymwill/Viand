import type { Cuisine, DietaryRequirement, PriceLevel } from "../types";

export interface Restaurant {
  id: string;
  name: string;
  /**
   * Stable identifier shared by every location of the same brand. Used to keep
   * the three presented options from being three branches of one chain. Null
   * for independents.
   */
  chainId: string | null;
  address: string;
  cuisine: Cuisine;
  priceLevel: PriceLevel;
  /** 0–5. */
  rating: number;
  distanceMiles: number;
  mapsUrl: string;
  /** Dietary requirements this restaurant can accommodate. */
  accommodates: DietaryRequirement[];
  openNow: boolean;
}

export interface RestaurantSearchInput {
  /** Free text exactly as the group typed it. Not geocoded in phase 1. */
  locationText: string;
  radiusMiles: number;
  /** Cuisines any member asked for; a hint for ranking, never a filter. */
  cuisineHints?: Cuisine[];
  maxPriceLevel?: PriceLevel | null;
  openNowOnly?: boolean;
}

export interface RestaurantProvider {
  search(input: RestaurantSearchInput): Promise<Restaurant[]>;
}

/** Thrown by providers that are wired up but not configured for this environment. */
export class RestaurantProviderNotConfiguredError extends Error {
  constructor(providerName: string, detail: string) {
    super(`${providerName} is not configured: ${detail}`);
    this.name = "RestaurantProviderNotConfiguredError";
  }
}
