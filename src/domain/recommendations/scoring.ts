import { CUISINE_FAMILIES, type Cuisine, type MemberPreference } from "../types";
import type { Restaurant } from "../restaurants/provider";

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
 */
export function hardRestrictions(
  restaurant: Restaurant,
  preference: MemberPreference,
): HardRestriction[] {
  const violations: HardRestriction[] = [];

  if (preference.excludedCuisines.includes(restaurant.cuisine)) {
    violations.push({ kind: "excluded_cuisine", cuisine: restaurant.cuisine });
  }

  for (const requirement of preference.dietary) {
    if (!restaurant.accommodates.includes(requirement)) {
      violations.push({ kind: "dietary", requirement });
    }
  }

  if (preference.maxPriceLevel != null && restaurant.priceLevel > preference.maxPriceLevel) {
    violations.push({ kind: "price", maxPriceLevel: preference.maxPriceLevel });
  }

  if (preference.maxDistanceMiles != null && restaurant.distanceMiles > preference.maxDistanceMiles) {
    violations.push({ kind: "distance", maxDistanceMiles: preference.maxDistanceMiles });
  }

  return violations;
}

export function isEligibleForAll(
  restaurant: Restaurant,
  preferences: readonly MemberPreference[],
): boolean {
  return preferences.every((preference) => hardRestrictions(restaurant, preference).length === 0);
}

function cuisineScore(restaurant: Restaurant, preference: MemberPreference): number {
  if (preference.preferredCuisines.length === 0) return 0.7;
  if (preference.preferredCuisines.includes(restaurant.cuisine)) return 1;
  if (preference.preferredCuisines.some((cuisine) => sharesFamily(cuisine, restaurant.cuisine))) {
    return 0.85;
  }
  return 0.35;
}

function priceComfort(restaurant: Restaurant, preference: MemberPreference): number {
  if (preference.maxPriceLevel == null) return 0.75;
  if (restaurant.priceLevel > preference.maxPriceLevel) return 0;
  // Comfortably under their ceiling scores higher than sitting exactly on it.
  return 0.6 + 0.4 * ((preference.maxPriceLevel - restaurant.priceLevel) / 3);
}

function distanceComfort(restaurant: Restaurant, preference: MemberPreference): number {
  const horizon = preference.maxDistanceMiles ?? DISTANCE_HORIZON_MILES;
  return clamp01(1 - restaurant.distanceMiles / horizon);
}

/** How well one restaurant serves one member, 0–1. */
export function memberCompatibility(
  restaurant: Restaurant,
  preference: MemberPreference,
): number {
  if (preference.noPreference) return NO_PREFERENCE_COMPATIBILITY;
  return clamp01(
    0.6 * cuisineScore(restaurant, preference) +
      0.2 * priceComfort(restaurant, preference) +
      0.2 * distanceComfort(restaurant, preference),
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
 */
export function scoreRestaurant(
  restaurant: Restaurant,
  preferences: readonly MemberPreference[],
): GroupScore {
  if (preferences.length === 0) {
    // No stated preferences: fall back to intrinsic quality only.
    const distance = clamp01(1 - restaurant.distanceMiles / DISTANCE_HORIZON_MILES);
    const rating = clamp01((restaurant.rating - 3) / 2);
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

  const compatibilities = preferences.map((preference) => memberCompatibility(restaurant, preference));
  const weakestMember = Math.min(...compatibilities);
  const averageMember = compatibilities.reduce((sum, value) => sum + value, 0) / compatibilities.length;

  const withCuisineOpinion = preferences.filter(
    (preference) => preference.preferredCuisines.length > 0,
  );
  const cuisineMatch =
    withCuisineOpinion.length === 0
      ? 0.5
      : withCuisineOpinion.filter((preference) =>
          preference.preferredCuisines.includes(restaurant.cuisine),
        ).length / withCuisineOpinion.length;

  const distance = clamp01(1 - restaurant.distanceMiles / DISTANCE_HORIZON_MILES);
  const rating = clamp01((restaurant.rating - 3) / 2);
  const priceMatch =
    preferences.reduce((sum, preference) => sum + priceComfort(restaurant, preference), 0) /
    preferences.length;

  const total =
    SCORE_WEIGHTS.weakestMember * weakestMember +
    SCORE_WEIGHTS.averageMember * averageMember +
    SCORE_WEIGHTS.cuisineMatch * cuisineMatch +
    SCORE_WEIGHTS.distance * distance +
    SCORE_WEIGHTS.rating * rating +
    SCORE_WEIGHTS.priceMatch * priceMatch;

  return { total, weakestMember, averageMember, cuisineMatch, distance, rating, priceMatch };
}
