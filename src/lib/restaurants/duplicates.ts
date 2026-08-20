import type { Restaurant } from "@/domain/restaurants/provider";
import { distanceMiles, type LatLng } from "./geo";

/**
 * Collapses the same restaurant mapped more than once.
 *
 * OpenStreetMap has no unique-business key, so the same place is regularly
 * entered twice by different contributors with slightly different spellings.
 * Downtown Los Angeles carries "Korea BBQ House" and "Korean BBQ House" as
 * separate nodes six metres apart at the same street address — which reached a
 * group as two of its five options, so a shortlist of five was really a
 * shortlist of four.
 *
 * Proximity alone is not enough: a food hall or a busy block genuinely has
 * several restaurants within a few metres. So a duplicate has to be both very
 * close *and* named nearly the same.
 */

/** Two entries further apart than this are different places, whatever they are called. */
const SAME_PLACE_METRES = 60;
const MILES_TO_METRES = 1609.344;

/** Lowercased, punctuation and spacing removed: "Korea BBQ House" -> "koreabbqhouse". */
function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Levenshtein distance, bailing out once it cannot matter. Names this close are
 * spelling variants of one business — "korea" against "korean" — not two
 * restaurants that happen to sound alike.
 */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      current[j] = value;
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

function sameName(a: string, b: string): boolean {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // One being contained in the other covers "Viand" against "Viand Cafe".
  if (left.startsWith(right) || right.startsWith(left)) return true;
  // Two edits absorbs a plural, an accent, or "korea" against "korean".
  return editDistance(left, right, 2) <= 2;
}

export interface Locatable {
  readonly restaurant: Restaurant;
  readonly position: LatLng;
}

/**
 * How much a source has said about a listing. When two entries describe one
 * restaurant, the fuller one is the one worth keeping — the duplicate is
 * usually a bare name-and-pin somebody dropped without noticing the original.
 */
function detail(restaurant: Restaurant): number {
  return [
    restaurant.address,
    restaurant.website,
    restaurant.phone,
    restaurant.openingHoursRaw,
    restaurant.priceLevel != null ? "p" : null,
    restaurant.rating != null ? "r" : null,
    restaurant.accommodates.length > 0 ? "d" : null,
  ].filter(Boolean).length;
}

export function dropDuplicates(entries: readonly Locatable[]): Restaurant[] {
  const kept: Locatable[] = [];

  for (const entry of entries) {
    const existing = kept.findIndex(
      (other) =>
        distanceMiles(entry.position, other.position) * MILES_TO_METRES <= SAME_PLACE_METRES &&
        sameName(entry.restaurant.name, other.restaurant.name),
    );

    if (existing === -1) {
      kept.push(entry);
      continue;
    }

    // Keep whichever entry says more; a tie keeps the one already held, so the
    // result stays stable for a given input order.
    if (detail(entry.restaurant) > detail(kept[existing]!.restaurant)) {
      kept[existing] = entry;
    }
  }

  return kept.map((entry) => entry.restaurant);
}
