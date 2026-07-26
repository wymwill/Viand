/** Geo helpers shared by every live restaurant provider. */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export const METRES_PER_MILE = 1609.344;
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
