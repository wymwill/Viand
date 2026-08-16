/** Geo helpers shared by every live restaurant provider. */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export const METRES_PER_MILE = 1609.344;
/** Side length of the cache-bucketing grid. Coarse enough to raise the cache
 * hit rate for nearby shares, fine enough that two different neighbourhoods
 * never collide. */
export const CACHE_GRID_CELL_METRES = 750;
const EARTH_RADIUS_MILES = 3958.8;

/** A plain "lat,lng" pair, which is how a shared location usually arrives. */
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

/**
 * Buckets a coordinate onto a metre-scale grid so nearby searches can share a
 * cache entry. Longitude cells are widened by 1/cos(latitude) so they stay
 * roughly square near the poles; this is a cache key, not a distance
 * calculation, so the approximation only needs to be stable, not precise.
 */
export function snapToGrid(center: LatLng, cellMetres = CACHE_GRID_CELL_METRES): string {
  const metresPerDegreeLat = 111_320;
  const metresPerDegreeLng = metresPerDegreeLat * Math.cos((center.latitude * Math.PI) / 180);
  const latCell = Math.round((center.latitude * metresPerDegreeLat) / cellMetres);
  const lngCell = Math.round(
    (center.longitude * Math.max(metresPerDegreeLng, 1)) / cellMetres,
  );
  return `${latCell}:${lngCell}`;
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
 * Branches of one brand share a chain id so the recommendation engine never
 * offers the group three doors of the same restaurant. OSM publishes no chain
 * identifier, so the normalised display name stands in for one.
 */
export function chainIdOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
