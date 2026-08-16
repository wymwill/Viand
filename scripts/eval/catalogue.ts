import type { Restaurant } from "@/domain/restaurants/provider";
import { CUISINES, DIETARY_REQUIREMENTS, type Cuisine, type PriceLevel } from "@/domain/types";
import type { Rng } from "./rng";

/**
 * A seeded synthetic catalogue.
 *
 * `MOCK_RESTAURANTS` is 20 hand-tuned entries chosen so the unit tests can
 * assert stable numbers. That makes it a poor benchmark: once a group's hard
 * constraints are applied it often collapses to two or three survivors, and
 * every strategy then picks the same thing. A wider generated catalogue gives
 * the strategies room to actually disagree, which is the only way differences
 * between them become visible.
 *
 * Pass `--catalogue=mock` to evaluate against the shipped demo set instead.
 */

const NAME_PREFIXES = [
  "Golden", "Blue", "Little", "Old", "The Copper", "Red", "Green", "Silver",
  "Wild", "Iron", "Sunny", "North", "Corner", "Lucky", "Bright",
] as const;

const NAME_SUFFIXES = [
  "Kitchen", "House", "Table", "Grill", "Room", "Counter", "Spoon", "Yard",
  "Garden", "Bowl", "Cellar", "Diner",
] as const;

const STREETS = [
  "College Ave", "Telegraph Ave", "Shattuck Ave", "University Ave", "Center St",
  "Bancroft Way", "Dwight Way", "Solano Ave", "San Pablo Ave", "Ashby Ave",
] as const;

/**
 * Cuisines a diet is plausibly served by. Accommodation is not drawn purely at
 * random: if every restaurant were equally likely to be vegan-friendly, a
 * dietary constraint would eliminate a uniform slice of the catalogue and
 * carry no structure for a strategy to get right or wrong.
 */
const DIET_AFFINITY: Partial<Record<Cuisine, readonly string[]>> = {
  salad: ["vegetarian", "vegan", "gluten_free", "dairy_free", "nut_free"],
  cafe: ["vegetarian", "vegan", "gluten_free", "dairy_free"],
  indian: ["vegetarian", "vegan", "halal", "gluten_free"],
  thai: ["vegetarian", "vegan", "gluten_free"],
  vietnamese: ["vegetarian", "gluten_free"],
  mediterranean: ["vegetarian", "vegan", "halal", "gluten_free"],
  middle_eastern: ["vegetarian", "vegan", "halal"],
  greek: ["vegetarian", "gluten_free"],
  mexican: ["vegetarian", "vegan", "gluten_free"],
  ethiopian: ["vegetarian", "vegan", "gluten_free"],
  italian: ["vegetarian"],
  pizza: ["vegetarian"],
  japanese: ["shellfish_free"],
  bbq: ["gluten_free"],
  american: ["vegetarian"],
  deli: ["vegetarian", "kosher"],
};

/** Cuisines a synthetic catalogue may contain. Excludes the unknown sentinel. */
export const EVAL_CUISINES: readonly Cuisine[] = CUISINES;

export function generateCatalogue(rng: Rng, size: number): Restaurant[] {
  const restaurants: Restaurant[] = [];
  const chains = ["chain-a", "chain-b", "chain-c"];

  for (let i = 0; i < size; i += 1) {
    const cuisine = rng.pick(EVAL_CUISINES);
    const name = `${rng.pick(NAME_PREFIXES)} ${rng.pick(NAME_SUFFIXES)}`;
    const address = `${rng.int(10, 990)} ${rng.pick(STREETS)}`;

    // Diets this cuisine plausibly serves, then a coin flip per diet, so
    // accommodation correlates with cuisine the way it does in real listings.
    const plausible = DIET_AFFINITY[cuisine] ?? [];
    const accommodates = DIETARY_REQUIREMENTS.filter(
      (requirement) => plausible.includes(requirement) && rng.bool(0.65),
    );

    // A minority carry no rating, which is the OpenStreetMap case: the scorer
    // falls back to listing completeness there, and the harness should cover it.
    const hasRating = rng.bool(0.85);

    restaurants.push({
      id: `syn-${String(i).padStart(3, "0")}`,
      name,
      chainId: rng.bool(0.15) ? rng.pick(chains) : null,
      address,
      cuisine,
      priceLevel: rng.int(1, 4) as PriceLevel,
      rating: hasRating ? rng.round(3, 5, 1) : 0,
      distanceMiles: rng.round(0.2, 5, 1),
      mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(`${name}, ${address}`)}`,
      accommodates: [...accommodates],
      openNow: true,
      ...(hasRating ? {} : { completeness: rng.round(0.3, 1, 2) }),
    });
  }

  return restaurants;
}
