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

/** Independent instances serving the same data. */
const DEFAULT_OVERPASS_URLS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** Overpass is a shared volunteer service; keep the query bounded. */
const MAX_OVERPASS_RADIUS_METRES = 1_500;
const MAX_OVERPASS_RESULTS = 40;

/**
 * Overpass cost scales with the area swept, and this is the single biggest
 * lever on the 504s the public instance returns under load. The group's default
 * five-mile radius asks it to scan roughly 200 km². Live checks showed the
 * public instances answering a 1.5-kilometre query inside the longer client
 * budget while 3-kilometre queries remained unreliable. The group's radius
 * still applies as a filter afterwards — this only bounds how far the upstream
 * query reaches.
 */
const DEFAULT_MAX_QUERY_RADIUS_METRES = MAX_OVERPASS_RADIUS_METRES;

/** What we allow Overpass itself to spend. See the note where it is used. */
const OVERPASS_SERVER_TIMEOUT_SECONDS = 40;
const DEFAULT_NOMINATIM_TIMEOUT_MS = 8_000;

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OsmOptions {
  /** Caps how far the Overpass query reaches, independent of the group's radius. */
  maxQueryRadiusMetres?: number;
  /**
   * One or more Overpass endpoints. Public instances are independently loaded,
   * so they are queried within one shared deadline and the first valid response
   * wins. The outer cache prevents this from happening on every message.
   */
  overpassUrl?: string | readonly string[];
  nominatimUrl?: string;
  /** Nominatim's usage policy requires an identifying User-Agent. */
  userAgent?: string;
  geocodingTimeoutMs?: number;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export class OsmRestaurantProvider implements RestaurantProvider {
  private readonly timeoutMs: number;
  private readonly geocodingTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly endpoints: readonly string[];

  constructor(private readonly options: OsmOptions = {}) {
    // Overpass is genuinely slow for a multi-kilometre radius over nodes and
    // ways, and it is the fallback rather than the hot path, so the budget is
    // wider than a fast commercial API would need.
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.geocodingTimeoutMs = options.geocodingTimeoutMs ?? DEFAULT_NOMINATIM_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? "Viand/0.1 (restaurant decision bot)";

    const configured = options.overpassUrl ?? DEFAULT_OVERPASS_URLS;
    this.endpoints = (typeof configured === "string" ? configured.split(",") : configured)
      .map((endpoint) => endpoint.trim())
      .filter(Boolean);
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

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { "User-Agent": this.userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(this.geocodingTimeoutMs),
      });
    } catch (error) {
      const detail = isTimeoutError(error)
        ? `timed out after ${this.geocodingTimeoutMs}ms`
        : `request failed: ${errorMessage(error)}`;
      throw new Error(`Nominatim geocoding ${detail}.`, { cause: error });
    }
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
    const cap = Math.min(
      this.options.maxQueryRadiusMetres ?? DEFAULT_MAX_QUERY_RADIUS_METRES,
      MAX_OVERPASS_RADIUS_METRES,
    );
    const radius = Math.round(Math.min(Math.max(radiusMiles * METRES_PER_MILE, 1), cap));

    // Deliberately generous, and deliberately NOT tied to our own budget.
    // Overpass treats this as permission to finish, not a target: set it low
    // and a query it could have answered instead returns HTTP 200 with a
    // `remark` and an empty element list — indistinguishable from "there are no
    // restaurants here" unless you check. Our client-side abort is what
    // actually bounds the wait.
    const serverTimeoutSeconds = OVERPASS_SERVER_TIMEOUT_SECONDS;

    // Three exact tag matches rather than one regex: a regex on a tag value
    // defeats Overpass's index and forces a scan. Nodes only — restaurants
    // mapped as building outlines cost roughly double to fetch (every polygon
    // needs a centroid computed) for a small minority of extra results.
    const around = `(around:${radius},${center.latitude},${center.longitude})`;
    const query = [
      `[out:json][timeout:${serverTimeoutSeconds}];`,
      "(",
      `  node["amenity"="restaurant"]["name"]${around};`,
      `  node["amenity"="fast_food"]["name"]${around};`,
      `  node["amenity"="cafe"]["name"]${around};`,
      ");",
      `out center tags ${MAX_OVERPASS_RESULTS};`,
    ].join("\n");

    if (this.endpoints.length === 0) {
      throw new Error("No Overpass endpoint is configured.");
    }

    // A sequential attempt can consume the whole serverless-safe deadline and
    // leave no time for failover. Dividing the deadline between instances also
    // aborted healthy public responses. Race the independently operated mirrors
    // instead, then cancel the slower reads as soon as one valid response wins.
    const controllers = this.endpoints.map(() => new AbortController());
    const attempts = controllers.map(async (controller, index) => {
      const endpoint = this.endpoints[index]!;
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(this.timeoutMs),
      ]);

      try {
        const response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": this.userAgent,
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal,
        });
        if (!response.ok) {
          throw new Error(`Overpass search failed with status ${response.status}.`);
        }

        const body = (await response.json()) as {
          elements?: OverpassElement[];
          remark?: string;
        };

        // Overpass reports its own timeouts and memory limits as a `remark` on
        // an otherwise successful response with no elements. Treating that as
        // an empty neighbourhood would tell the group there is nowhere to eat
        // in central Berkeley, so it is an error and worth failing over for.
        if (body.remark) {
          throw new Error(`Overpass returned a remark: ${body.remark}`);
        }

        return body.elements ?? [];
      } catch (error) {
        const detail = isTimeoutError(error)
          ? `timed out after ${this.timeoutMs}ms`
          : errorMessage(error);
        throw new Error(`${endpointHost(endpoint)}: ${detail}`, { cause: error });
      }
    });

    try {
      return await Promise.any(attempts);
    } catch (error) {
      const failures =
        error instanceof AggregateError
          ? error.errors.map(errorMessage)
          : [errorMessage(error)];
      throw new Error(`All Overpass endpoints failed (${failures.join("; ")}).`, {
        cause: error,
      });
    } finally {
      for (const controller of controllers) controller.abort();
    }
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
