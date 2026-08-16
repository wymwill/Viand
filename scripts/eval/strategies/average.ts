import type { Restaurant } from "@/domain/restaurants/provider";
import type { Cuisine } from "@/domain/types";
import type { EvalGroup } from "../generate";

/**
 * Strategy (a): naive averaging of the stated preference vectors.
 *
 * The obvious first thing anyone builds, and the baseline worth beating. It
 * collapses the group into one pseudo-member — average budget, average
 * distance, cuisine weighted by how many people named it — and picks the
 * argmax.
 *
 * It applies no hard constraints, and that is the honest version of this
 * strategy rather than a strawman: averaging is a single mechanism, and once
 * you have decided to average, a dietary requirement is just another number
 * that gets averaged away. One vegan in a group of five becomes 20% of a
 * signal instead of a wall. The violation column is where that shows up.
 */

const CUISINE_WEIGHT = 0.5;
const PRICE_WEIGHT = 0.25;
const DISTANCE_WEIGHT = 0.25;

/** Miles used when nobody stated a limit. Matches the scorer's horizon. */
const DEFAULT_DISTANCE = 5;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function averageStrategy(group: EvalGroup, catalogue: readonly Restaurant[]): Restaurant | null {
  if (catalogue.length === 0) return null;

  const members = group.members.map((member) => member.stated);

  // Cuisine demand: the fraction of the group that named each cuisine.
  const demand = new Map<Cuisine, number>();
  for (const member of members) {
    for (const cuisine of member.preferredCuisines) {
      demand.set(cuisine, (demand.get(cuisine) ?? 0) + 1);
    }
  }
  for (const [cuisine, count] of demand) demand.set(cuisine, count / members.length);

  const statedPrices = members
    .map((member) => member.maxPriceLevel)
    .filter((level): level is NonNullable<typeof level> => level != null);
  const averagePrice =
    statedPrices.length === 0
      ? 4
      : statedPrices.reduce((sum, level) => sum + level, 0) / statedPrices.length;

  const statedDistances = members
    .map((member) => member.maxDistanceMiles)
    .filter((miles): miles is number => miles != null);
  const averageDistance =
    statedDistances.length === 0
      ? DEFAULT_DISTANCE
      : statedDistances.reduce((sum, miles) => sum + miles, 0) / statedDistances.length;

  let best: Restaurant | null = null;
  let bestScore = -Infinity;

  for (const restaurant of catalogue) {
    const cuisine = demand.get(restaurant.cuisine) ?? 0;
    const price = clamp01(1 - Math.max(0, restaurant.priceLevel - averagePrice) / 3);
    const distance = clamp01(1 - restaurant.distanceMiles / averageDistance);
    const score = CUISINE_WEIGHT * cuisine + PRICE_WEIGHT * price + DISTANCE_WEIGHT * distance;

    // Ties break on id so the strategy is reproducible across runs.
    if (score > bestScore || (score === bestScore && best != null && restaurant.id < best.id)) {
      best = restaurant;
      bestScore = score;
    }
  }

  return best;
}
