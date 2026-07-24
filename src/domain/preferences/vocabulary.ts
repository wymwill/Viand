import type { Cuisine, DietaryRequirement } from "../types";

/**
 * Phrase -> cuisine, matched longest-phrase-first so "korean bbq" resolves to
 * korean rather than bbq. Each matched span is blanked out after it matches so
 * it cannot also count as a second cuisine.
 */
export const CUISINE_PHRASES: ReadonlyArray<readonly [string, Cuisine]> = [
  ["korean bbq", "korean"],
  ["middle eastern", "middle_eastern"],
  ["tex mex", "mexican"],
  ["dim sum", "chinese"],
  ["banh mi", "vietnamese"],
  ["pad thai", "thai"],
  ["mexican", "mexican"],
  ["burritos", "mexican"],
  ["burrito", "mexican"],
  ["tacos", "mexican"],
  ["taco", "mexican"],
  ["korean", "korean"],
  ["kbbq", "korean"],
  ["bibimbap", "korean"],
  ["japanese", "japanese"],
  ["izakaya", "japanese"],
  ["sushi", "japanese"],
  ["ramen", "ramen"],
  ["noodles", "ramen"],
  ["noodle", "ramen"],
  ["chinese", "chinese"],
  ["szechuan", "chinese"],
  ["sichuan", "chinese"],
  ["thai", "thai"],
  ["vietnamese", "vietnamese"],
  ["pho", "vietnamese"],
  ["indian", "indian"],
  ["curry", "indian"],
  ["dosa", "indian"],
  ["italian", "italian"],
  ["pasta", "italian"],
  ["pizza", "pizza"],
  ["pizzeria", "pizza"],
  ["american", "american"],
  ["burgers", "american"],
  ["burger", "american"],
  ["diner", "american"],
  ["wings", "american"],
  ["barbecue", "bbq"],
  ["barbeque", "bbq"],
  ["brisket", "bbq"],
  ["bbq", "bbq"],
  ["mediterranean", "mediterranean"],
  ["falafel", "mediterranean"],
  ["hummus", "mediterranean"],
  ["greek", "greek"],
  ["gyros", "greek"],
  ["gyro", "greek"],
  ["shawarma", "middle_eastern"],
  ["kebabs", "middle_eastern"],
  ["kebab", "middle_eastern"],
  ["french", "french"],
  ["bistro", "french"],
  ["ethiopian", "ethiopian"],
  ["injera", "ethiopian"],
  ["seafood", "seafood"],
  ["oysters", "seafood"],
  ["shrimp", "seafood"],
  ["sandwiches", "deli"],
  ["sandwich", "deli"],
  ["deli", "deli"],
  ["subs", "deli"],
  ["brunch", "cafe"],
  ["breakfast", "cafe"],
  ["bakery", "cafe"],
  ["coffee", "cafe"],
  ["cafe", "cafe"],
  ["salads", "salad"],
  ["salad", "salad"],
];

/**
 * Phrase -> dietary requirement. "allergy" marks the phrase as allergy-derived,
 * which flips hasAllergyConcern and attaches the safety disclaimer.
 */
export const DIETARY_PHRASES: ReadonlyArray<
  readonly [string, DietaryRequirement, "allergy" | "choice"]
> = [
  ["allergic to shellfish", "shellfish_free", "allergy"],
  ["shellfish allergy", "shellfish_free", "allergy"],
  ["shellfish", "shellfish_free", "allergy"],
  ["allergic to nuts", "nut_free", "allergy"],
  ["nut allergy", "nut_free", "allergy"],
  ["tree nut", "nut_free", "allergy"],
  ["peanuts", "nut_free", "allergy"],
  ["peanut", "nut_free", "allergy"],
  ["lactose intolerant", "dairy_free", "allergy"],
  ["lactose", "dairy_free", "allergy"],
  ["dairy free", "dairy_free", "choice"],
  ["gluten free", "gluten_free", "choice"],
  ["glutenfree", "gluten_free", "choice"],
  ["celiac", "gluten_free", "allergy"],
  ["coeliac", "gluten_free", "allergy"],
  ["vegetarian", "vegetarian", "choice"],
  ["veggie", "vegetarian", "choice"],
  ["vegan", "vegan", "choice"],
  ["halal", "halal", "choice"],
  ["kosher", "kosher", "choice"],
];

/**
 * A cuisine or dietary term is treated as excluded when one of these appears
 * earlier in the same clause. Clause boundaries keep "no seafood but mexican is
 * great" from excluding mexican too.
 */
export const NEGATION_MARKERS: readonly string[] = [
  "anything but",
  "anything except",
  "do not want",
  "dont want",
  "cant eat",
  "cannot eat",
  "cant do",
  "allergic to",
  "sick of",
  "tired of",
  "excluding",
  "except",
  "without",
  "avoid",
  "hates",
  "hate",
  "nothing",
  "never",
  "not",
  "no",
];

/** Phrases meaning "I will eat whatever", honoured only when nothing was preferred. */
export const NO_PREFERENCE_PHRASES: readonly string[] = [
  "no preference",
  "dont care",
  "do not care",
  "dont mind",
  "surprise me",
  "up to you",
  "im flexible",
  "im easy",
  "flexible",
  "whatever",
  "anything",
];

/** Budget words that imply a price ceiling. Upscale words imply no ceiling. */
export const BUDGET_PHRASES: ReadonlyArray<readonly [string, 1 | 2 | 3 | 4]> = [
  ["cheap eats", 1],
  ["cheap", 1],
  ["budget", 1],
  ["inexpensive", 1],
  ["affordable", 2],
  ["mid range", 2],
  ["midrange", 2],
  ["moderate", 2],
];
