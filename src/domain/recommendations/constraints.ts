import type { Cuisine, DietaryRequirement, MemberPreference, PriceLevel } from "../types";

/**
 * Hard constraints and soft preferences, as separate types.
 *
 * A `MemberPreference` is a record of what one person *said*. That is a single
 * coherent thing and it stays whole — it is what the parsers produce, what the
 * session stores, and what the copy layer reads. But the recommender treats its
 * fields in two categorically different ways, and conflating them is a bug
 * waiting to happen:
 *
 * - **Hard constraints** are absolute. A restaurant violating one is *removed*
 *   before ranking. They are never traded off, never partially credited, and a
 *   scorer must never see them — a scoring function's whole job is to trade
 *   things off, so handing it a dietary requirement is a category error that
 *   ends with someone being served food they cannot eat.
 * - **Soft preferences** are exactly the things that *should* be traded off.
 *
 * The two interfaces below share no field names and carry disjoint `kind`
 * discriminants, so neither is structurally assignable to the other, and
 * `MemberPreference` is assignable to neither. That makes three mistakes
 * compile errors rather than review comments:
 *
 *   scoreRestaurant(r, hardConstraintsOf(p))  // hard constraints into a scorer
 *   hardRestrictions(r, softPreferencesOf(p)) // soft preferences as a filter
 *   scoreRestaurant(r, p)                     // the unsplit record, unprojected
 *
 * The last one matters most: you cannot reach a scorer without having first
 * said out loud which half of the record you meant.
 *
 * See `tests/unit/constraint-split.test.ts`, which asserts each of those is
 * rejected by the compiler.
 */

export interface HardConstraints {
  readonly kind: "hard";
  /** Cuisines this member ruled out. Absolute. */
  readonly forbiddenCuisines: readonly Cuisine[];
  /** Dietary needs the restaurant must accommodate. Absolute. */
  readonly requiredDiets: readonly DietaryRequirement[];
  /** Price level this member will not go above. Null when unstated. */
  readonly priceCeiling: PriceLevel | null;
  /** Miles this member will not travel beyond. Null when unstated. */
  readonly distanceLimit: number | null;
}

export interface SoftPreferences {
  readonly kind: "soft";
  /** Cuisines this member asked for. A ranking signal, never a filter. */
  readonly preferredCuisines: readonly Cuisine[];
  /** True when the member explicitly said anything works for them. */
  readonly easygoing: boolean;
  /**
   * The same number as `HardConstraints.priceCeiling`, in its second role.
   *
   * Price and distance are the two genuinely dual-use fields: they both
   * eliminate options *and* shape how comfortable a surviving option feels
   * (sitting well under your ceiling scores better than sitting exactly on
   * it). Splitting them into one side only would silently change scores, so
   * both projections read the same source field and cannot drift apart.
   */
  readonly priceComfortCeiling: PriceLevel | null;
  /** The same number as `HardConstraints.distanceLimit`, in its second role. */
  readonly distanceHorizon: number | null;
}

export function hardConstraintsOf(preference: MemberPreference): HardConstraints {
  return {
    kind: "hard",
    forbiddenCuisines: preference.excludedCuisines,
    requiredDiets: preference.dietary,
    priceCeiling: preference.maxPriceLevel,
    distanceLimit: preference.maxDistanceMiles,
  };
}

export function softPreferencesOf(preference: MemberPreference): SoftPreferences {
  return {
    kind: "soft",
    preferredCuisines: preference.preferredCuisines,
    easygoing: preference.noPreference,
    priceComfortCeiling: preference.maxPriceLevel,
    distanceHorizon: preference.maxDistanceMiles,
  };
}

/**
 * Both projections of a group, in one pass and in the original member order.
 * Index `i` of each array refers to the same person, which is what lets the
 * eval harness attribute a violation back to the member who stated it.
 */
export function splitPreferences(preferences: readonly MemberPreference[]): {
  hard: HardConstraints[];
  soft: SoftPreferences[];
} {
  return {
    hard: preferences.map(hardConstraintsOf),
    soft: preferences.map(softPreferencesOf),
  };
}
