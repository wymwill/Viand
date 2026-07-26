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
  /** The place's own site, when the source publishes one. */
  website?: string | null;
  phone?: string | null;
  /**
   * How thoroughly the source describes this listing, 0–1. Used as a weak
   * stand-in for a rating on sources that have none — see `scoring.ts`.
   */
  completeness?: number;
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

/** Where a set of results came from. Surfaced to the group, never inferred. */
export type RestaurantSource = "mock" | "osm";

export interface RestaurantSearchResult {
  restaurants: Restaurant[];
  source: RestaurantSource;
  /**
   * One line shown under the options so a demo catalogue can never be mistaken
   * for live listings. Attribution is a property of the search, not of each
   * restaurant, which is why it lives here rather than on Restaurant.
   */
  sourceLabel: string;
  /**
   * The area the search actually centred on after geocoding, when the provider
   * geocodes. Null when the provider ignores the location text.
   */
  resolvedLocation: string | null;
}

export const MOCK_SOURCE_LABEL =
  "Demo results from a fixed sample catalogue — not live listings.";

export const OSM_SOURCE_LABEL = "Live results from OpenStreetMap.";

export interface RestaurantProvider {
  search(input: RestaurantSearchInput): Promise<RestaurantSearchResult>;
}

