import {
  OSM_SOURCE_LABEL,
  type Restaurant,
  type RestaurantProvider,
  type RestaurantSearchInput,
  type RestaurantSearchResult,
} from "@/domain/restaurants/provider";
import { METRES_PER_MILE, chainIdOf, distanceMiles, parseSharedLocation, type LatLng } from "./geo";
import {
  accommodatesFromOsmTags,
  addressFromOsmTags,
  brandOf,
  completenessOfOsmTags,
  cuisineFromOsmTags,
  isNameBrandChain,
  phoneFromOsmTags,
  websiteFromOsmTags,
} from "./osm-tags";

/**
 * Listings from OpenStreetMap, geocoded through Nominatim.
 *
 * This is the free, keyless fallback. It carries the `diet:*` tags that let a
 * halal, kosher, or gluten-free request succeed, which commercial place APIs
 * generally cannot answer. What it does not carry is ratings or prices, so
 * results from here rank on distance and cuisine fit alone.
 */

const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** Overpass is a shared volunteer service; keep the query bounded. */
const MAX_OVERPASS_RADIUS_METRES = 20_000;
const MAX_OVERPASS_RESULTS = 60;

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OsmOptions {
  overpassUrl?: string;
  nominatimUrl?: string;
  /** Nominatim's usage policy requires an identifying User-Agent. */
  userAgent?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Nominatim returns the whole administrative hierarchy — "Downtown Berkeley,
 * 2160, Shattuck Avenue, Berkeley, Alameda County, California, 94704, United
 * States" — which is unreadable in a text message. Keep the leading component,
 * carrying the street along when the first component is a bare house number.
 */
export function shortLocationLabel(displayName: string): string {
  const parts = displayName
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const [first, second] = parts;
  if (!first) return displayName;
  if (/^\d+$/.test(first) && second) return `${first} ${second}`;
  return first;
}

function coordinatesOf(element: OverpassElement): LatLng | null {
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (latitude == null || longitude == null) return null;
  return { latitude, longitude };
}

export class OsmRestaurantProvider implements RestaurantProvider {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(private readonly options: OsmOptions = {}) {
    // Overpass is genuinely slow for a multi-kilometre radius over nodes and
    // ways, and it is the fallback rather than the hot path, so the budget is
    // wider than a fast commercial API would need.
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? "Viand/0.1 (restaurant decision bot)";
  }

  async search(input: RestaurantSearchInput): Promise<RestaurantSearchResult> {
    const { center, label } = await this.resolveLocation(input.locationText);
    const elements = await this.searchOverpass(center, input.radiusMiles);

    const restaurants: Restaurant[] = [];
    for (const element of elements) {
      const restaurant = this.normalise(element, center);
      if (!restaurant) continue;
      if (restaurant.distanceMiles > input.radiusMiles) continue;
      if (input.maxPriceLevel != null && restaurant.priceLevel > input.maxPriceLevel) continue;
      if (input.openNowOnly && !restaurant.openNow) continue;
      restaurants.push(restaurant);
    }

    restaurants.sort((a, b) => a.distanceMiles - b.distanceMiles);

    return {
      restaurants,
      source: "osm",
      sourceLabel: OSM_SOURCE_LABEL,
      resolvedLocation: label,
    };
  }

  private async resolveLocation(locationText: string): Promise<{ center: LatLng; label: string }> {
    const shared = parseSharedLocation(locationText);
    if (shared) return { center: shared, label: "the shared location" };

    const query = locationText.trim();
    if (query.length === 0) throw new Error("Cannot search without a location.");

    const url = new URL(this.options.nominatimUrl ?? DEFAULT_NOMINATIM_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const response = await this.fetchImpl(url, {
      headers: { "User-Agent": this.userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Geocoding failed with status ${response.status}.`);

    const body = (await response.json()) as { lat?: string; lon?: string; display_name?: string }[];
    const first = body[0];
    if (!first?.lat || !first.lon) throw new Error(`Could not geocode "${query}".`);

    return {
      center: { latitude: Number(first.lat), longitude: Number(first.lon) },
      label: first.display_name ? shortLocationLabel(first.display_name) : query,
    };
  }

  private async searchOverpass(center: LatLng, radiusMiles: number): Promise<OverpassElement[]> {
    const radius = Math.round(
      Math.min(Math.max(radiusMiles * METRES_PER_MILE, 1), MAX_OVERPASS_RADIUS_METRES),
    );
    const filter = `["amenity"~"^(restaurant|fast_food|cafe)$"]["name"]`;
    // Tell Overpass the same budget we are willing to wait, so it gives up on
    // its side instead of spending server time on a result we have abandoned.
    const serverTimeoutSeconds = Math.max(1, Math.floor(this.timeoutMs / 1000));
    const query = [
      `[out:json][timeout:${serverTimeoutSeconds}];`,
      "(",
      `  node${filter}(around:${radius},${center.latitude},${center.longitude});`,
      `  way${filter}(around:${radius},${center.latitude},${center.longitude});`,
      ");",
      `out center tags ${MAX_OVERPASS_RESULTS};`,
    ].join("\n");

    const response = await this.fetchImpl(this.options.overpassUrl ?? DEFAULT_OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.userAgent,
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Overpass search failed with status ${response.status}.`);

    const body = (await response.json()) as { elements?: OverpassElement[] };
    return body.elements ?? [];
  }

  private normalise(element: OverpassElement, center: LatLng): Restaurant | null {
    const tags = element.tags ?? {};
    const name = tags.name?.trim();
    const position = coordinatesOf(element);
    if (!name || !position || element.id == null) return null;

    // The group asked for somewhere to eat, not the nearest McDonald's.
    if (isNameBrandChain(tags)) return null;

    return {
      id: `${element.type ?? "node"}/${element.id}`,
      name,
      // A real brand id when OSM has one, falling back to the name otherwise.
      chainId: brandOf(tags) ?? chainIdOf(name),
      address: addressFromOsmTags(tags),
      cuisine: cuisineFromOsmTags(tags),
      // OSM has no price data. The field is not optional downstream, and a mid
      // band neither sneaks an expensive restaurant past a budget nor hides a
      // cheap one.
      priceLevel: 2,
      // No ratings either. Zero reads as "unknown" downstream and is omitted
      // from the message rather than shown as nought stars.
      rating: 0,
      distanceMiles: distanceMiles(center, position),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${position.latitude},${position.longitude}`,
      accommodates: accommodatesFromOsmTags(tags),
      website: websiteFromOsmTags(tags),
      phone: phoneFromOsmTags(tags),
      completeness: completenessOfOsmTags(tags),
      // OSM's `opening_hours` grammar is far richer than a boolean, and a wrong
      // "open now" sends a group to a closed door. Nothing is claimed.
      openNow: true,
    };
  }
}
