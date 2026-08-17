import type { Restaurant } from "@/domain/restaurants/provider";
import type { EvalGroup, EvalMember, LatentHardConstraint } from "./generate";

/**
 * Ground-truth satisfaction, 0–1.
 *
 * Deliberately *not* `memberCompatibility`. This is the yardstick all three
 * strategies are measured with, so it must be independent of any of them —
 * grading the deterministic scorer with its own objective function would be
 * circular and would report a win it did not earn.
 *
 * It reads the member's latent utility vector, which no strategy has access
 * to. The weights below mirror the intuition the product is built on rather
 * than the scorer's constants: what you eat matters most, then how far you
 * went and what it cost.
 */

export const SATISFACTION_WEIGHTS = {
  cuisine: 0.5,
  price: 0.25,
  distance: 0.25,
} as const;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function violatesHardConstraint(
  restaurant: Restaurant,
  constraint: LatentHardConstraint | null,
): boolean {
  if (constraint == null) return false;

  switch (constraint.kind) {
    case "diet":
      return !restaurant.accommodates.includes(constraint.requirement);
    case "excluded_cuisine":
      return restaurant.cuisine === constraint.cuisine;
    case "price_cap":
      return restaurant.priceLevel != null && restaurant.priceLevel > constraint.maxPriceLevel;
    case "distance_cap":
      return restaurant.distanceMiles > constraint.maxMiles;
  }
}

/**
 * A violated hard constraint scores zero, not a penalty. A restaurant that
 * cannot feed you is not a worse meal — it is not a meal. Averaging a small
 * penalty into an otherwise good score is exactly the mistake the hard/soft
 * type split exists to prevent, so the metric refuses to make it either.
 */
export function satisfaction(member: EvalMember, restaurant: Restaurant): number {
  if (violatesHardConstraint(restaurant, member.latent.hardConstraint)) return 0;

  const { latent } = member;
  const cuisine = latent.cuisineUtility[restaurant.cuisine];
  const price = clamp01(
    // Synthetic catalogues always have a price; this is defensive typing for
    // the shared Restaurant shape and leaves unknown price neutral.
    1 -
      latent.pricePenalty *
        Math.max(0, (restaurant.priceLevel ?? latent.idealPriceLevel) - latent.idealPriceLevel),
  );
  const distance = clamp01(1 - restaurant.distanceMiles / latent.distanceTolerance);

  return clamp01(
    SATISFACTION_WEIGHTS.cuisine * cuisine +
      SATISFACTION_WEIGHTS.price * price +
      SATISFACTION_WEIGHTS.distance * distance,
  );
}

export interface GroupOutcome {
  groupId: string;
  /** Null when the strategy declined to pick anything. */
  restaurantId: string | null;
  minSatisfaction: number;
  meanSatisfaction: number;
  /** Members whose hard constraint the chosen restaurant breaks. */
  violatedMemberIds: string[];
}

export function evaluateChoice(group: EvalGroup, chosen: Restaurant | null): GroupOutcome {
  if (chosen == null) {
    return {
      groupId: group.id,
      restaurantId: null,
      minSatisfaction: 0,
      meanSatisfaction: 0,
      violatedMemberIds: [],
    };
  }

  const scores = group.members.map((member) => satisfaction(member, chosen));
  const violated = group.members
    .filter((member) => violatesHardConstraint(chosen, member.latent.hardConstraint))
    .map((member) => member.id);

  return {
    groupId: group.id,
    restaurantId: chosen.id,
    minSatisfaction: Math.min(...scores),
    meanSatisfaction: scores.reduce((sum, value) => sum + value, 0) / scores.length,
    violatedMemberIds: violated,
  };
}

export interface StrategySummary {
  strategy: string;
  /** Groups the strategy actually answered. */
  answered: number;
  /** Groups it declined — no eligible option, or a failed model call. */
  abstained: number;
  /** Mean over answered groups of the least-satisfied member. The fairness number. */
  meanMinSatisfaction: number;
  meanSatisfaction: number;
  /** The single worst group's least-satisfied member. */
  worstGroupMin: number;
  /** (group, member) pairs whose hard constraint was broken. */
  violations: number;
  groupsWithViolation: number;
  /** Model or strategy errors, counted rather than thrown. */
  errors: number;
}

export function summarise(
  strategy: string,
  outcomes: readonly GroupOutcome[],
  errors = 0,
): StrategySummary {
  // Abstentions are excluded from the satisfaction averages rather than scored
  // as zero. A strategy that says "nothing here works for all of you" has done
  // something different from one that picks a restaurant somebody cannot eat
  // at, and averaging them together would hide exactly that distinction. The
  // abstained column keeps it visible.
  const answered = outcomes.filter((outcome) => outcome.restaurantId != null);
  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  const mins = answered.map((outcome) => outcome.minSatisfaction);

  return {
    strategy,
    answered: answered.length,
    abstained: outcomes.length - answered.length,
    meanMinSatisfaction: mean(mins),
    meanSatisfaction: mean(answered.map((outcome) => outcome.meanSatisfaction)),
    worstGroupMin: mins.length === 0 ? 0 : Math.min(...mins),
    violations: answered.reduce((sum, outcome) => sum + outcome.violatedMemberIds.length, 0),
    groupsWithViolation: answered.filter((outcome) => outcome.violatedMemberIds.length > 0).length,
    errors,
  };
}
