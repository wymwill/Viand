import { UNKNOWN_CUISINE, type Cuisine, type DietaryRequirement } from "@/domain/types";

/**
 * Google place types that correspond to a cuisine we model. Types absent from
 * this table (`restaurant`, `food`, `point_of_interest`, and every cuisine we
 * do not have a vocabulary for) fall through to UNKNOWN_CUISINE rather than
 * being forced into the nearest neighbour — a mislabelled cuisine would score
 * as a match for someone who asked for it, which is worse than no match.
 */
const CUISINE_BY_GOOGLE_TYPE: Readonly<Record<string, Cuisine>> = {
  mexican_restaurant: "mexican",
  korean_restaurant: "korean",
  japanese_restaurant: "japanese",
  sushi_restaurant: "japanese",
  ramen_restaurant: "ramen",
  chinese_restaurant: "chinese",
  thai_restaurant: "thai",
  vietnamese_restaurant: "vietnamese",
  indian_restaurant: "indian",
  italian_restaurant: "italian",
  pizza_restaurant: "pizza",
  american_restaurant: "american",
  hamburger_restaurant: "american",
  steak_house: "american",
  bar_and_grill: "american",
  diner: "american",
  barbecue_restaurant: "bbq",
  mediterranean_restaurant: "mediterranean",
  greek_restaurant: "greek",
  middle_eastern_restaurant: "middle_eastern",
  lebanese_restaurant: "middle_eastern",
  turkish_restaurant: "middle_eastern",
  afghani_restaurant: "middle_eastern",
  french_restaurant: "french",
  seafood_restaurant: "seafood",
  sandwich_shop: "deli",
  bagel_shop: "deli",
  deli: "deli",
  cafe: "cafe",
  coffee_shop: "cafe",
  bakery: "cafe",
  breakfast_restaurant: "cafe",
  brunch_restaurant: "cafe",
  cafeteria: "cafe",
  salad_bar: "salad",
};

/**
 * `primaryType` is Google's own single best category, so it wins; the wider
 * `types` array is scanned only as a fallback and in the order Google returned.
 */
export function cuisineFromGoogleTypes(
  primaryType: string | undefined,
  types: readonly string[] = [],
): Cuisine {
  const primary = primaryType ? CUISINE_BY_GOOGLE_TYPE[primaryType] : undefined;
  if (primary) return primary;

  for (const type of types) {
    const mapped = CUISINE_BY_GOOGLE_TYPE[type];
    if (mapped) return mapped;
  }

  return UNKNOWN_CUISINE;
}

/**
 * Dietary capabilities we can state as fact about a real restaurant.
 *
 * Places publishes exactly one dietary signal — `servesVegetarianFood` — and
 * says nothing about vegan, halal, kosher, gluten, or allergen handling. We
 * therefore report only that flag plus the two place types that are
 * definitionally unambiguous, and infer nothing from cuisine.
 *
 * The cost of that restraint is real: `hardRestrictions` treats every dietary
 * requirement as absolute, so a halal, kosher, gluten-free, or nut-free request
 * will find no live options and the group will be told so. That is the correct
 * failure. Guessing from cuisine would put a confident dietary claim about a
 * real restaurant in front of someone with an allergy, who would act on it.
 */
export function accommodatesFromPlace(input: {
  servesVegetarianFood?: boolean;
  primaryType?: string;
  types?: readonly string[];
}): DietaryRequirement[] {
  const accommodates = new Set<DietaryRequirement>();
  const types = [input.primaryType, ...(input.types ?? [])].filter(Boolean);

  if (input.servesVegetarianFood) accommodates.add("vegetarian");
  if (types.includes("vegetarian_restaurant")) accommodates.add("vegetarian");
  if (types.includes("vegan_restaurant")) {
    accommodates.add("vegan");
    accommodates.add("vegetarian");
  }

  return [...accommodates];
}
