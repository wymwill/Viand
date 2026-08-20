import type { Restaurant } from "../restaurants/provider";
import { MAX_OPTIONS, type DietaryRequirement, type MemberPreference } from "../types";
import {
  hardConstraintsOf,
  splitPreferences,
  type HardConstraints,
} from "./constraints";
import { hardRestrictions, isEligibleForAll, scoreRestaurant, type GroupScore } from "./scoring";

export interface Candidate {
  restaurant: Restaurant;
  score: GroupScore;
  /** One-line reason shown under the option in the group message. */
  explanation: string;
}

export interface RecommendationResult {
  candidates: Candidate[];
  /** True when any member's wording indicated an allergy. Drives the disclaimer. */
  needsAllergyDisclaimer: boolean;
  /**
   * True when no restaurant could be *confirmed* to meet a stated dietary
   * requirement and the options below are offered unchecked. The group must be
   * told: an unverified option is a lead to call ahead about, not a match.
   */
  dietaryUnverified: boolean;
  /** How many restaurants were removed by someone's hard restriction. */
  eliminatedCount: number;
}

export interface RecommendOptions {
  /** Restaurant ids explicitly vetoed; treated as a hard restriction. */
  vetoedRestaurantIds?: readonly string[];
  /** How many options to present. Defaults to the product maximum of five. */
  limit?: number;
}

const DIETARY_LABELS: Record<DietaryRequirement, string> = {
  vegetarian: "vegetarian",
  vegan: "vegan",
  gluten_free: "gluten-free",
  halal: "halal",
  kosher: "kosher",
  dairy_free: "dairy-free",
  nut_free: "nut-free",
  shellfish_free: "shellfish-free",
};

export function formatPrice(priceLevel: number): string {
  return "$".repeat(Math.max(1, Math.min(4, priceLevel)));
}

export function formatDistance(miles: number): string {
  return `${miles.toFixed(1)} mi`;
}

/**
 * Ranks eligible restaurants, then picks a spread rather than the raw top three.
 * Three branches of one chain is never a real choice, and three of the same
 * cuisine barely is, so distinctness is relaxed only as far as necessary to
 * fill the slots.
 */
export function recommend(
  restaurants: readonly Restaurant[],
  preferences: readonly MemberPreference[],
  options: RecommendOptions = {},
): RecommendationResult {
  const limit = options.limit ?? MAX_OPTIONS;
  const vetoed = new Set(options.vetoedRestaurantIds ?? []);

  // The one place the two halves are separated. Everything downstream sees only
  // the half it is entitled to: `hard` eliminates, `soft` ranks what survives.
  const { hard, soft } = splitPreferences(preferences);

  const available = (restaurant: Restaurant) =>
    // Unverified hours remain eligible, but a confirmed-closed restaurant must
    // never survive into ranking regardless of how well it otherwise matches.
    !vetoed.has(restaurant.id) && restaurant.openNow !== false;

  const confirmed = restaurants.filter(
    (restaurant) => available(restaurant) && isEligibleForAll(restaurant, hard),
  );

  /**
   * Absence of a `diet:*` tag is missing data, not a denial. Most sources
   * publish none — in central Boston, no restaurant carries one — so reading
   * absence as "does not accommodate" eliminated every candidate and told any
   * group containing a vegetarian that nothing worked for them.
   *
   * Confirmed matches are never diluted: this pool is consulted only when the
   * group would otherwise get nothing at all, and what it returns is labelled
   * unverified so nobody mistakes it for a checked answer. Every constraint the
   * source *can* speak to — a ruled-out cuisine, a price ceiling, a distance
   * limit, closing time — still eliminates here.
   */
  const dietaryRequested = hard.some((entry) => entry.requiredDiets.length > 0);
  const useUnverified = confirmed.length === 0 && dietaryRequested;
  const eligible = useUnverified
    ? restaurants.filter(
        (restaurant) =>
          available(restaurant) &&
          // Only listings whose source published no dietary data at all. A
          // catalogue that states dietary facts completely is telling us no,
          // and that must still eliminate.
          restaurant.dietaryDataKnown === false &&
          hard.every((entry) =>
            hardRestrictions(restaurant, entry).every(
              (violation) => violation.kind === "dietary",
            ),
          ),
      )
    : confirmed;

  const eliminatedCount = restaurants.length - eligible.length;

  const scored = eligible
    .map((restaurant) => ({ restaurant, score: scoreRestaurant(restaurant, soft) }))
    .sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      // This is ordering only; the fallback never feeds the weighted score.
      const ratingDifference = (b.restaurant.rating ?? -1) - (a.restaurant.rating ?? -1);
      if (ratingDifference !== 0) return ratingDifference;
      if (a.restaurant.distanceMiles !== b.restaurant.distanceMiles) {
        return a.restaurant.distanceMiles - b.restaurant.distanceMiles;
      }
      return a.restaurant.id.localeCompare(b.restaurant.id);
    });

  const picked: typeof scored = [];
  const chainCounts = new Map<string, number>();
  const usedCuisines = new Set<string>();

  /**
   * Cuisines somebody actually asked for.
   *
   * The distinct-cuisine pass exists so a group that has not agreed on
   * anything sees a spread rather than five pizzerias. When the group *has*
   * named a cuisine that instinct inverts: asking for Korean in Boston
   * returned one Korean place and then filled the other four slots with
   * Japanese, Thai, Chinese and Vietnamese, while two other Korean
   * restaurants sat unshown. Variety is a good default, not a good answer to
   * a stated request.
   */
  const requestedCuisines = new Set(soft.flatMap((member) => member.preferredCuisines));

  const canTake = (entry: (typeof scored)[number], maxPerChain: number, uniqueCuisine: boolean) => {
    if (picked.includes(entry)) return false;
    if (
      uniqueCuisine &&
      usedCuisines.has(entry.restaurant.cuisine) &&
      !requestedCuisines.has(entry.restaurant.cuisine)
    ) {
      return false;
    }
    const chainId = entry.restaurant.chainId;
    if (chainId != null && (chainCounts.get(chainId) ?? 0) >= maxPerChain) return false;
    return true;
  };

  const take = (entry: (typeof scored)[number]) => {
    picked.push(entry);
    usedCuisines.add(entry.restaurant.cuisine);
    const chainId = entry.restaurant.chainId;
    if (chainId != null) chainCounts.set(chainId, (chainCounts.get(chainId) ?? 0) + 1);
  };

  // Pass 1: distinct cuisine and distinct chain. Pass 2: allow a repeated
  // cuisine. Pass 3: allow a second location of a chain — never a third.
  for (const [maxPerChain, uniqueCuisine] of [
    [1, true],
    [1, false],
    [2, false],
  ] as const) {
    for (const entry of scored) {
      if (picked.length >= limit) break;
      if (canTake(entry, maxPerChain, uniqueCuisine)) take(entry);
    }
    if (picked.length >= limit) break;
  }

  const groupDietary = collectGroupDietary(hard);
  const candidates: Candidate[] = picked.map((entry, index) => ({
    restaurant: entry.restaurant,
    score: entry.score,
    explanation: explain(entry, index, picked, hard, groupDietary),
  }));

  return {
    candidates,
    needsAllergyDisclaimer: preferences.some((preference) => preference.hasAllergyConcern),
    dietaryUnverified: useUnverified && eligible.length > 0,
    eliminatedCount,
  };
}

function collectGroupDietary(constraints: readonly HardConstraints[]): DietaryRequirement[] {
  const all = new Set<DietaryRequirement>();
  for (const entry of constraints) {
    for (const requirement of entry.requiredDiets) all.add(requirement);
  }
  return [...all];
}

/**
 * Explanations describe why an option survived, so they read the hard side.
 * They are presentation, not ranking — nothing here feeds back into a score.
 */
function explain(
  entry: { restaurant: Restaurant; score: GroupScore },
  index: number,
  all: ReadonlyArray<{ restaurant: Restaurant; score: GroupScore }>,
  constraints: readonly HardConstraints[],
  groupDietary: readonly DietaryRequirement[],
): string {
  const clauses: string[] = [];

  if (index === 0) clauses.push("Best overall match");

  const anyBudgetStated = constraints.some((c) => c.priceCeiling != null);
  const budgetOkForAll = constraints.every(
    (c) =>
      c.priceCeiling == null ||
      (entry.restaurant.priceLevel != null && entry.restaurant.priceLevel <= c.priceCeiling),
  );
  if (anyBudgetStated && budgetOkForAll) clauses.push("works for everyone's budget");

  const bestCuisine = Math.max(...all.map((other) => other.score.cuisineMatch));
  if (entry.score.cuisineMatch > 0 && entry.score.cuisineMatch >= bestCuisine && index !== 0) {
    clauses.push("strongest cuisine match");
  }

  const servedDietary = groupDietary.filter((requirement) =>
    entry.restaurant.accommodates.includes(requirement),
  );
  const firstServed = servedDietary[0];
  if (firstServed) clauses.push(`has ${DIETARY_LABELS[firstServed]} options`);

  const closest = Math.min(...all.map((other) => other.restaurant.distanceMiles));
  if (entry.restaurant.distanceMiles === closest && all.length > 1) {
    clauses.push("closest option");
  }

  const sentence = clauses.slice(0, 2).join(", ");
  const base = sentence.length > 0 ? capitalize(sentence) : "Solid all-round option";

  // Honesty beats salesmanship: if this option genuinely fails someone, say so.
  const weakLink = entry.score.weakestMember < 0.5;
  return weakLink ? `${base}, but a weaker match for one person.` : `${base}.`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Bullets for the winner announcement. */
export function winnerReasons(
  candidate: Candidate,
  preferences: readonly MemberPreference[],
): string[] {
  const reasons: string[] = [];
  const { restaurant, score } = candidate;
  const constraints = preferences.map(hardConstraintsOf);

  const anyBudgetStated = constraints.some((c) => c.priceCeiling != null);
  if (
    anyBudgetStated &&
    restaurant.priceLevel != null &&
    constraints.every((c) => c.priceCeiling == null || restaurant.priceLevel! <= c.priceCeiling)
  ) {
    reasons.push("Works for everyone's budget");
  }

  for (const requirement of collectGroupDietary(constraints)) {
    if (restaurant.accommodates.includes(requirement)) {
      reasons.push(`Has ${DIETARY_LABELS[requirement]} choices`);
    }
  }

  reasons.push(`Only ${restaurant.distanceMiles.toFixed(1)} miles away`);

  if (score.cuisineMatch >= 0.5) reasons.push("Matches what most people asked for");

  return reasons.slice(0, 4);
}

/** Exposed for STATUS output and tests. */
export function eliminationReasons(
  restaurant: Restaurant,
  preferences: readonly MemberPreference[],
): string[] {
  return preferences
    .map(hardConstraintsOf)
    .flatMap((constraints) => hardRestrictions(restaurant, constraints))
    .map((violation) => violation.kind);
}
