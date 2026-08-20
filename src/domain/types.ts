/**
 * Core vocabulary shared across the decision domain. Everything in `src/domain`
 * is pure: no database, no network, no environment access. That is what lets the
 * whole decision flow be tested without Postgres or Linq credentials.
 */

export type DecisionState =
  | "COLLECTING_LOCATION"
  | "COLLECTING_PREFERENCES"
  /** A compromise cuisine has been proposed and the group is answering it. */
  | "AWAITING_CUISINE_APPROVAL"
  | "READY_TO_RECOMMEND"
  | "VOTING"
  | "COMPLETED"
  | "CANCELLED";

/** 1 = $, 4 = $$$$. */
export type PriceLevel = 1 | 2 | 3 | 4;

/**
 * We present up to five options and aim for at least three, so votes are
 * 1-indexed and bounded. Fewer than three only happens when the area genuinely
 * has little to offer once everyone's restrictions are applied.
 */
export const MAX_OPTIONS = 5;

export type OptionNumber = 1 | 2 | 3 | 4 | 5;

export const CUISINES = [
  "mexican",
  "korean",
  "japanese",
  "chinese",
  "thai",
  "vietnamese",
  "indian",
  "italian",
  "pizza",
  "american",
  "bbq",
  "mediterranean",
  "greek",
  "middle_eastern",
  "french",
  "ethiopian",
  "seafood",
  "ramen",
  "deli",
  "cafe",
  "salad",
] as const;

/**
 * Assigned when a live provider returns a category that maps to none of the
 * cuisines above. Deliberately not a member of CUISINES: it must never be
 * offered to a parser or a model as something a person could ask for, but it
 * has to be representable so real listings aren't silently mislabelled as a
 * cuisine they are not. It matches no stated preference and joins no family,
 * which is exactly how an unknown category should score.
 */
export const UNKNOWN_CUISINE = "other";

export type Cuisine = (typeof CUISINES)[number] | typeof UNKNOWN_CUISINE;

/**
 * Cuisines that satisfy each other reasonably well. Used to give partial credit
 * when a member's stated cuisine is unavailable but something adjacent is.
 */
export const CUISINE_FAMILIES: readonly (readonly Cuisine[])[] = [
  ["japanese", "ramen", "korean", "chinese", "vietnamese", "thai"],
  ["mediterranean", "greek", "middle_eastern"],
  ["italian", "pizza"],
  ["american", "bbq", "deli"],
  ["cafe", "salad", "deli"],
];

export const DIETARY_REQUIREMENTS = [
  "vegetarian",
  "vegan",
  "gluten_free",
  "halal",
  "kosher",
  "dairy_free",
  "nut_free",
  "shellfish_free",
] as const;

export type DietaryRequirement = (typeof DIETARY_REQUIREMENTS)[number];

/**
 * Requirements that come from an allergy rather than a choice. Any of these on
 * any member attaches the "confirm with the restaurant" disclaimer, because our
 * restaurant data is not authoritative about cross-contamination.
 */
export const ALLERGY_REQUIREMENTS: readonly DietaryRequirement[] = [
  "nut_free",
  "shellfish_free",
  "dairy_free",
  "gluten_free",
];

export interface MemberPreference {
  /** Preserved verbatim; never re-derived from the parsed fields. */
  originalMessage: string;
  preferredCuisines: Cuisine[];
  excludedCuisines: Cuisine[];
  dietary: DietaryRequirement[];
  maxPriceLevel: PriceLevel | null;
  maxDistanceMiles: number | null;
  /** True when the member explicitly said they are fine with anything. */
  noPreference: boolean;
  /** True when the wording indicates an allergy rather than a preference. */
  hasAllergyConcern: boolean;
}

export function emptyPreference(originalMessage: string): MemberPreference {
  return {
    originalMessage,
    preferredCuisines: [],
    excludedCuisines: [],
    dietary: [],
    maxPriceLevel: null,
    maxDistanceMiles: null,
    noPreference: false,
    hasAllergyConcern: false,
  };
}
