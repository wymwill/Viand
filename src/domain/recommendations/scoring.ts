import { CUISINE_FAMILIES, type Cuisine } from "../types";
import type { Restaurant } from "../restaurants/provider";
import type { HardConstraints, SoftPreferences } from "./constraints";

/** Weights from the product spec. Must sum to 1. */
export const SCORE_WEIGHTS = {
  weakestMember: 0.35,
  averageMember: 0.25,
  cuisineMatch: 0.15,
  distance: 0.1,
  rating: 0.1,
  priceMatch: 0.05,
} as const;

/** Distance beyond which the distance component contributes nothing. */
export const DISTANCE_HORIZON_MILES = 5;

/**
 * A member who said "anything" is genuinely satisfied by any surviving option,
 * so they score a flat high value rather than dragging down the weakest-member
 * term. Not 1.0 — someone with a met preference should still outrank them.
 */
export const NO_PREFERENCE_COMPATIBILITY = 0.8;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The quality term. A real rating is the best available signal, but sources
 * like OpenStreetMap publish none at all, in which case how completely the
 * listing is described stands in for it. That proxy is deliberately weak — it
 * says a place is real and well looked after, not that the food is good — and
 * it occupies the rating slot rather than adding weight of its own, so a source
 * with genuine ratings is never diluted by it.
 */
function qualitySignal(restaurant: Restaurant): number {
  if (restaurant.rating > 0) return clamp01((restaurant.rating - 3) / 2);
  return clamp01(restaurant.completeness ?? 0);
}

function sharesFamily(a: Cuisine, b: Cuisine): boolean {
  return CUISINE_FAMILIES.some((family) => family.includes(a) && family.includes(b));
}

export type HardRestriction =
  | { kind: "excluded_cuisine"; cuisine: Cuisine }
  | { kind: "dietary"; requirement: string }
  | { kind: "price"; maxPriceLevel: number }
  | { kind: "distance"; maxDistanceMiles: number };

/**
 * Restrictions are absolute: a restaurant violating any of them is removed
 * before scoring rather than penalised. Dietary needs are all treated as hard,
 * not only vegetarian and vegan — a halal or gluten-free requirement is no less
 * binding, and over-filtering is the safe direction.
 *
 * Takes `HardConstraints`, so a soft preference cannot be smuggled in and
 * silently used to eliminate a restaurant.
 */
export function hardRestrictions(
  restaurant: Restaurant,
  constraints: HardConstraints,
): HardRestriction[] {
  const violations: HardRestriction[] = [];

  if (constraints.forbiddenCuisines.includes(restaurant.cuisine)) {
    violations.push({ kind: "excluded_cuisine", cuisine: restaurant.cuisine });
  }

  for (const requirement of constraints.requiredDiets) {
    if (!restaurant.accommodates.includes(requirement)) {
      violations.push({ kind: "dietary", requirement });
    }
  }

  if (constraints.priceCeiling != null && restaurant.priceLevel > constraints.priceCeiling) {
    violations.push({ kind: "price", maxPriceLevel: constraints.priceCeiling });
  }

  if (constraints.distanceLimit != null && restaurant.distanceMiles > constraints.distanceLimit) {
    violations.push({ kind: "distance", maxDistanceMiles: constraints.distanceLimit });
  }

  return violations;
}

export function isEligibleForAll(
  restaurant: Restaurant,
  constraints: readonly HardConstraints[],
): boolean {
  return constraints.every((entry) => hardRestrictions(restaurant, entry).length === 0);
}

function cuisineScore(restaurant: Restaurant, soft: SoftPreferences): number {
  if (soft.preferredCuisines.length === 0) return 0.7;
  if (soft.preferredCuisines.includes(restaurant.cuisine)) return 1;
  if (soft.preferredCuisines.some((cuisine) => sharesFamily(cuisine, restaurant.cuisine))) {
    return 0.85;
  }
  return 0.35;
}

/**
 * The zero branch is not dead code. In the `recommend` path a restaurant over
 * someone's ceiling was already eliminated, but `scoreRestaurant` is also
 * called directly — by tests and by the eval harness — on unfiltered input,
 * where an over-budget option must still score zero comfort rather than a
 * negative number.
 */
function priceComfort(restaurant: Restaurant, soft: SoftPreferences): number {
  if (soft.priceComfortCeiling == null) return 0.75;
  if (restaurant.priceLevel > soft.priceComfortCeiling) return 0;
  // Comfortably under their ceiling scores higher than sitting exactly on it.
  return 0.6 + 0.4 * ((soft.priceComfortCeiling - restaurant.priceLevel) / 3);
}

function distanceComfort(restaurant: Restaurant, soft: SoftPreferences): number {
  const horizon = soft.distanceHorizon ?? DISTANCE_HORIZON_MILES;
  return clamp01(1 - restaurant.distanceMiles / horizon);
}

/** How well one restaurant serves one member, 0–1. */
export function memberCompatibility(restaurant: Restaurant, soft: SoftPreferences): number {
  if (soft.easygoing) return NO_PREFERENCE_COMPATIBILITY;
  return clamp01(
    0.6 * cuisineScore(restaurant, soft) +
      0.2 * priceComfort(restaurant, soft) +
      0.2 * distanceComfort(restaurant, soft),
  );
}

export interface GroupScore {
  total: number;
  weakestMember: number;
  averageMember: number;
  cuisineMatch: number;
  distance: number;
  rating: number;
  priceMatch: number;
}

/**
 * Weighted group fit. The weakest-member term carries the most weight, so an
 * option that delights three people and fails a fourth loses to one everybody
 * can live with — that fairness property is what the product is selling.
 *
 * Takes `SoftPreferences` only. Hard constraints are structurally unable to
 * reach this function, which is the point: they are applied by
 * `isEligibleForAll` before anything is ranked, and a constraint that has been
 * weighed against a rating has stopped being a constraint.
 */
export function scoreRestaurant(
  restaurant: Restaurant,
  soft: readonly SoftPreferences[],
): GroupScore {
  if (soft.length === 0) {
    // No stated preferences: fall back to intrinsic quality only.
    const distance = clamp01(1 - restaurant.distanceMiles / DISTANCE_HORIZON_MILES);
    const rating = qualitySignal(restaurant);
    const total =
      (SCORE_WEIGHTS.weakestMember + SCORE_WEIGHTS.averageMember + SCORE_WEIGHTS.cuisineMatch) * 0.7 +
      SCORE_WEIGHTS.distance * distance +
      SCORE_WEIGHTS.rating * rating +
      SCORE_WEIGHTS.priceMatch * 0.75;
    return {
      total,
      weakestMember: 0.7,
      averageMember: 0.7,
      cuisineMatch: 0.7,
      distance,
      rating,
      priceMatch: 0.75,
    };
  }

  const compatibilities = soft.map((entry) => memberCompatibility(restaurant, entry));
  const weakestMember = Math.min(...compatibilities);
  const averageMember = compatibilities.reduce((sum, value) => sum + value, 0) / compatibilities.length;

  const withCuisineOpinion = soft.filter((entry) => entry.preferredCuisines.length > 0);
  const cuisineMatch =
    withCuisineOpinion.length === 0
      ? 0.5
      : withCuisineOpinion.filter((entry) => entry.preferredCuisines.includes(restaurant.cuisine))
          .length / withCuisineOpinion.length;

  const distance = clamp01(1 - restaurant.distanceMiles / DISTANCE_HORIZON_MILES);
  const rating = qualitySignal(restaurant);
  const priceMatch =
    soft.reduce((sum, entry) => sum + priceComfort(restaurant, entry), 0) / soft.length;

  const total =
    SCORE_WEIGHTS.weakestMember * weakestMember +
    SCORE_WEIGHTS.averageMember * averageMember +
    SCORE_WEIGHTS.cuisineMatch * cuisineMatch +
    SCORE_WEIGHTS.distance * distance +
    SCORE_WEIGHTS.rating * rating +
    SCORE_WEIGHTS.priceMatch * priceMatch;

  return { total, weakestMember, averageMember, cuisineMatch, distance, rating, priceMatch };
}
