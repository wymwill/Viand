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
  hasDietaryData,
  isNameBrandChain,
  phoneFromOsmTags,
  websiteFromOsmTags,
} from "./osm-tags";
import { dropDuplicates, type Locatable } from "./duplicates";
import { evaluateOpeningHours } from "./opening-hours";

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

/** Overpass is a shared volunteer service; keep even configured queries bounded. */
const MAX_OVERPASS_RADIUS_METRES = 10_000;
const TIER_1_RADIUS_METRES = 1_500;
/**
 * Above this radius a query is restricted to a single amenity clause. See the
 * measurements in the query builder: clause count, not element type, is what
 * makes a wide Overpass search time out.
 */
const BROAD_QUERY_RADIUS_METRES = 2_500;
/**
 * Ceiling on elements fetched per query.
 *
 * This has to be far above what any real search returns, because Overpass
 * truncates in its own order rather than by distance. At 150 a five mile
 * search of central Boston returned 150 of the 1,409 restaurants actually
 * there — and *which* 150 varied between identical queries. One run gave a
 * spread across the whole radius with three Korean restaurants; another gave
 * nothing but the dense downtown core and no Korean at all, so a group asking
 * for Korean was shown five places that were not Korean. The cap was not
 * trimming a long tail, it was sampling arbitrarily and discarding 90% of the
 * data along with 28 of the 31 Korean listings.
 *
 * Uncapped costs little: the densest case measured, five miles around
 * Manhattan, returned 4,548 elements in 1.9 MB and under four seconds. This
 * number exists only so a pathological area cannot return something
 * unbounded; it is not meant to bind in normal use.
 */
const MAX_OVERPASS_RESULTS = 5_000;

/**
 * Ceiling on how far a single Overpass query may reach, independent of what the
 * group asked for, so one request cannot sweep an unbounded area of a
 * volunteer-run mirror. On 2026-08-16 one available mirror was
 * observed answering the existing capped node query in about 11 seconds at
 * 1.5km and 21.5 seconds at 8047m in both dense and suburban tests, while two
 * other public endpoints were overloaded even at 1.5km. That supports tiering
 * and endpoint failover, not a general reliability guarantee. The 10km ceiling
 * remains defense-in-depth for sparse areas where the result cap may not fill.
 */
const DEFAULT_MAX_QUERY_RADIUS_METRES = 8_100;

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

interface OverpassSearch {
  elements: OverpassElement[];
  searchedRadiusMetres: number;
  radiusDegraded: boolean;
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

function milesFromMetres(metres: number): string {
  return (Math.round((metres / METRES_PER_MILE) * 10) / 10).toFixed(1);
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
    const { elements, searchedRadiusMetres, radiusDegraded } = await this.searchOverpass(
      center,
      input.radiusMiles,
    );

    const located: Locatable[] = [];
    for (const element of elements) {
      const position = coordinatesOf(element);
      const restaurant = this.normalise(element, center, input.now, input.timeZone);
      if (!restaurant || !position) continue;
      if (restaurant.distanceMiles > input.radiusMiles) continue;
      if (
        input.maxPriceLevel != null &&
        restaurant.priceLevel != null &&
        restaurant.priceLevel > input.maxPriceLevel
      ) continue;
      if (input.openNowOnly && restaurant.openNow !== true) continue;
      located.push({ restaurant, position });
    }

    // OpenStreetMap has no unique-business key, so one restaurant entered twice
    // by different contributors reaches the group as two of its five options.
    const restaurants = dropDuplicates(located);
    restaurants.sort((a, b) => a.distanceMiles - b.distanceMiles);

    return {
      restaurants,
      source: "osm",
      sourceLabel: radiusDegraded
        ? `${OSM_SOURCE_LABEL} Searched within ${milesFromMetres(searchedRadiusMetres)} mi — the full ${input.radiusMiles} mi radius could not be reached right now.`
        : OSM_SOURCE_LABEL,
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

  /**
   * Searches the radius the group actually asked for.
   *
   * This previously ran a cheap 1.5km pass first and stopped there whenever it
   * returned enough results, which in any dense city meant a five mile request
   * was answered with a 0.93 mile search — and `radiusDegraded` stayed false,
   * so nobody was told. A restaurant two miles away was invisible no matter how
   * well it fit.
   *
   * The narrow query is now the fallback rather than the gate: the requested
   * radius is tried first, and only if that fails does a cheap close-in pass
   * run so the group gets something, flagged so the reply can say the full
   * radius was not reached. That is also no more load on the volunteer mirrors
   * than before — one query in the normal case, where a sparse area used to
   * cost two.
   */
  private async searchOverpass(center: LatLng, radiusMiles: number): Promise<OverpassSearch> {
    const cap = Math.min(
      this.options.maxQueryRadiusMetres ?? DEFAULT_MAX_QUERY_RADIUS_METRES,
      MAX_OVERPASS_RADIUS_METRES,
    );
    const targetRadius = Math.round(Math.min(Math.max(radiusMiles * METRES_PER_MILE, 1), cap));

    try {
      const elements = await this.queryOverpass(center, targetRadius);
      return { elements, searchedRadiusMetres: targetRadius, radiusDegraded: false };
    } catch (error) {
      const fallbackRadius = Math.min(TIER_1_RADIUS_METRES, targetRadius);
      // Nothing cheaper to try; the caller turns this into "couldn't reach the
      // listings", which is the truth.
      if (fallbackRadius >= targetRadius) throw error;

      const elements = await this.queryOverpass(center, fallbackRadius);
      if (elements.length === 0) throw error;
      return { elements, searchedRadiusMetres: fallbackRadius, radiusDegraded: true };
    }
  }

  private async queryOverpass(center: LatLng, radius: number): Promise<OverpassElement[]> {

    // Deliberately generous, and deliberately NOT tied to our own budget.
    // Overpass treats this as permission to finish, not a target: set it low
    // and a query it could have answered instead returns HTTP 200 with a
    // `remark` and an empty element list — indistinguishable from "there are no
    // restaurants here" unless you check. Our client-side abort is what
    // actually bounds the wait.
    const serverTimeoutSeconds = OVERPASS_SERVER_TIMEOUT_SECONDS;

    // Exact tag matches rather than one regex: a regex on a tag value defeats
    // Overpass's index and forces a scan.
    //
    // `nwr` rather than `node`, because in older, denser cities a large share
    // of restaurants are mapped as building outlines rather than points.
    //
    // How many amenity clauses we can afford depends on the radius, and that
    // is the whole reason wide searches used to collapse back to a one mile
    // result. Each clause is an independent spatial pass, and measured against
    // a public mirror over central Boston at five miles: one clause answered in
    // 2.7s, two took 38s, and three or more returned 504 — regardless of
    // whether they queried nodes or polygons. So a wide search asks only for
    // restaurants, which fills the result cap on its own in any dense area,
    // and the fuller set of eating places is reserved for close-in searches
    // where it is affordable.
    const around = `(around:${radius},${center.latitude},${center.longitude})`;
    const wide = radius > BROAD_QUERY_RADIUS_METRES;
    const clauses = wide
      ? [`  nwr["amenity"="restaurant"]["name"]${around};`]
      : [
          `  nwr["amenity"="restaurant"]["name"]${around};`,
          `  nwr["amenity"="fast_food"]["name"]${around};`,
          `  nwr["amenity"="cafe"]["name"]${around};`,
          `  nwr["amenity"="food_court"]["name"]${around};`,
          // Bars and pubs serve food and a group deciding where to eat
          // routinely lands on one.
          `  nwr["amenity"="bar"]["food"="yes"]["name"]${around};`,
          `  nwr["amenity"="pub"]["name"]${around};`,
        ];

    const query = [
      `[out:json][timeout:${serverTimeoutSeconds}];`,
      "(",
      ...clauses,
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

  private normalise(
    element: OverpassElement,
    center: LatLng,
    now: Date,
    timeZone: string | null | undefined,
  ): Restaurant | null {
    const tags = element.tags ?? {};
    const name = tags.name?.trim();
    const position = coordinatesOf(element);
    if (!name || !position || element.id == null) return null;

    // The group asked for somewhere to eat, not the nearest McDonald's.
    if (isNameBrandChain(tags)) return null;

    const openStatus = evaluateOpeningHours(tags.opening_hours, now, timeZone);

    return {
      id: `${element.type ?? "node"}/${element.id}`,
      name,
      // A real brand id when OSM has one, falling back to the name otherwise.
      chainId: brandOf(tags) ?? chainIdOf(name),
      address: addressFromOsmTags(tags),
      cuisine: cuisineFromOsmTags(tags),
      // OSM has no price data, so null is honest where a middle-band guess could
      // wrongly exclude a listing against a real budget.
      priceLevel: null,
      // OSM has no rating data, so this is null rather than a guessed sentinel.
      rating: null,
      distanceMiles: distanceMiles(center, position),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${position.latitude},${position.longitude}`,
      accommodates: accommodatesFromOsmTags(tags),
      website: websiteFromOsmTags(tags),
      phone: phoneFromOsmTags(tags),
      completeness: completenessOfOsmTags(tags),
      openNow: openStatus === "open" ? true : openStatus === "closed" ? false : null,
      openingHoursRaw: tags.opening_hours ?? null,
      dietaryDataKnown: hasDietaryData(tags),
    };
  }
}
