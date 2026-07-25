import {
  GOOGLE_PLACES_SOURCE_LABEL,
  RestaurantProviderNotConfiguredError,
  type Restaurant,
  type RestaurantProvider,
  type RestaurantSearchInput,
  type RestaurantSearchResult,
} from "@/domain/restaurants/provider";
import type { PriceLevel } from "@/domain/types";
import { accommodatesFromPlace, cuisineFromGoogleTypes } from "./google-cuisine-map";

/**
 * Live restaurant data from the Google Places API (New), with the location
 * resolved through the Geocoding API.
 *
 * The provider's job is to supply normalised candidates, not to judge them:
 * everything about fairness, dietary elimination, ranking, and the three-way
 * diversity of the final options belongs to the recommendation engine, which
 * runs identically over these results and over the mock catalogue.
 */

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby";

/** Only the fields we normalise. Places bills by field mask, so it stays tight. */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.priceLevel",
  "places.primaryType",
  "places.types",
  "places.currentOpeningHours.openNow",
  "places.googleMapsUri",
  "places.servesVegetarianFood",
].join(",");

const METRES_PER_MILE = 1609.344;
const EARTH_RADIUS_MILES = 3958.8;
/** Places rejects a radius above 50km. */
const MAX_RADIUS_METRES = 50_000;
const MAX_RESULTS = 20;

interface LatLng {
  latitude: number;
  longitude: number;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: LatLng;
  rating?: number;
  priceLevel?: string;
  primaryType?: string;
  types?: string[];
  currentOpeningHours?: { openNow?: boolean };
  googleMapsUri?: string;
  servesVegetarianFood?: boolean;
}

export interface GooglePlacesOptions {
  apiKey: string;
  /** Bounds each of the two upstream calls independently. */
  timeoutMs?: number;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * A plain "lat,lng" pair, which is how a shared location arrives once the
 * message text is normalised.
 */
const BARE_COORDINATES = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** Coordinates embedded in an Apple or Google Maps link. */
const LINKED_COORDINATES =
  /(?:[?&](?:ll|q|sll|daddr|center)=|@)(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;

function isPlausible(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/**
 * Recognises a shared location before spending a geocoding call on it. Handles
 * both a bare coordinate pair and the map links iMessage produces.
 */
export function parseSharedLocation(locationText: string): LatLng | null {
  const match = BARE_COORDINATES.exec(locationText) ?? LINKED_COORDINATES.exec(locationText);
  if (!match?.[1] || !match[2]) return null;

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return isPlausible(latitude, longitude) ? { latitude, longitude } : null;
}

export function distanceMiles(from: LatLng, to: LatLng): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Google's price bands, which are coarser than a number of dollars. An
 * unspecified level becomes 2 because the field is not optional downstream and
 * a mid band is the least distorting assumption — it neither smuggles an
 * expensive restaurant past someone's budget nor hides a cheap one.
 */
const PRICE_LEVELS: Readonly<Record<string, PriceLevel>> = {
  PRICE_LEVEL_FREE: 1,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function priceLevelOf(raw: string | undefined): PriceLevel {
  return (raw ? PRICE_LEVELS[raw] : undefined) ?? 2;
}

/**
 * Branches of one brand share a chain id so the recommendation engine never
 * offers the group three doors of the same restaurant. Google has no chain
 * identifier, so the normalised display name stands in for one.
 */
function chainIdOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export class GooglePlacesRestaurantProvider implements RestaurantProvider {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GooglePlacesOptions) {
    if (!options.apiKey) {
      throw new RestaurantProviderNotConfiguredError(
        "GooglePlacesRestaurantProvider",
        "GOOGLE_MAPS_API_KEY is required when USE_MOCK_RESTAURANTS=false.",
      );
    }
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(input: RestaurantSearchInput): Promise<RestaurantSearchResult> {
    const { center, label } = await this.resolveLocation(input.locationText);
    const places = await this.searchNearby(center, input.radiusMiles);

    const restaurants = places
      .map((place) => this.normalise(place, center))
      .filter((restaurant): restaurant is Restaurant => restaurant != null)
      .filter((restaurant) => {
        if (restaurant.distanceMiles > input.radiusMiles) return false;
        if (input.maxPriceLevel != null && restaurant.priceLevel > input.maxPriceLevel) return false;
        if (input.openNowOnly && !restaurant.openNow) return false;
        return true;
      })
      .sort((a, b) => a.distanceMiles - b.distanceMiles);

    return {
      restaurants,
      source: "google_places",
      sourceLabel: GOOGLE_PLACES_SOURCE_LABEL,
      resolvedLocation: label,
    };
  }

  /**
   * A shared location is already a point and needs no geocoding call; anything
   * typed — neighborhood, ZIP code, or full address — goes through Geocoding,
   * which handles all three shapes with the same request.
   */
  private async resolveLocation(locationText: string): Promise<{ center: LatLng; label: string }> {
    const shared = parseSharedLocation(locationText);
    if (shared) return { center: shared, label: "the shared location" };

    const query = locationText.trim();
    if (query.length === 0) {
      throw new Error("Cannot search without a location.");
    }

    const url = new URL(GEOCODE_URL);
    url.searchParams.set("address", query);
    url.searchParams.set("key", this.options.apiKey);

    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Geocoding failed with status ${response.status}.`);
    }

    const body = (await response.json()) as {
      status?: string;
      results?: { formatted_address?: string; geometry?: { location?: { lat: number; lng: number } } }[];
    };

    const first = body.results?.[0];
    const location = first?.geometry?.location;
    if (body.status !== "OK" || !location) {
      throw new Error(`Could not geocode "${query}" (status ${body.status ?? "unknown"}).`);
    }

    return {
      center: { latitude: location.lat, longitude: location.lng },
      label: first?.formatted_address ?? query,
    };
  }

  private async searchNearby(center: LatLng, radiusMiles: number): Promise<GooglePlace[]> {
    const radius = Math.min(Math.max(radiusMiles * METRES_PER_MILE, 1), MAX_RADIUS_METRES);

    const response = await this.fetchImpl(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.options.apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: ["restaurant"],
        maxResultCount: MAX_RESULTS,
        rankPreference: "POPULARITY",
        locationRestriction: { circle: { center, radius } },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Places search failed with status ${response.status}.`);
    }

    const body = (await response.json()) as { places?: GooglePlace[] };
    return body.places ?? [];
  }

  /** Null for a listing too incomplete to present — no id, name, or position. */
  private normalise(place: GooglePlace, center: LatLng): Restaurant | null {
    const name = place.displayName?.text?.trim();
    if (!place.id || !name || !place.location) return null;

    return {
      id: place.id,
      name,
      chainId: chainIdOf(name),
      address: place.formattedAddress ?? "",
      cuisine: cuisineFromGoogleTypes(place.primaryType, place.types),
      priceLevel: priceLevelOf(place.priceLevel),
      // Unrated places keep a 0 rather than borrowing an average they have not
      // earned. Rating is only a tenth of the score, so they stay eligible and
      // simply rank below comparable rated options.
      rating: place.rating ?? 0,
      distanceMiles: distanceMiles(center, place.location),
      mapsUrl: place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${place.id}`,
      accommodates: accommodatesFromPlace(place),
      openNow: place.currentOpeningHours?.openNow ?? true,
    };
  }
}
