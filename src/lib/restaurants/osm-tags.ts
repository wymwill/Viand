import {
  UNKNOWN_CUISINE,
  type Cuisine,
  type DietaryRequirement,
} from "@/domain/types";

/**
 * OpenStreetMap `cuisine` values that map onto a cuisine we model. The tag is a
 * free-form, semicolon-separated list ("pizza;italian"), so the first
 * recognised entry wins and anything unrecognised becomes UNKNOWN_CUISINE
 * rather than being forced into a neighbour.
 */
const CUISINE_BY_OSM_VALUE: Readonly<Record<string, Cuisine>> = {
  mexican: "mexican",
  taco: "mexican",
  tacos: "mexican",
  burrito: "mexican",
  tex_mex: "mexican",
  korean: "korean",
  japanese: "japanese",
  sushi: "japanese",
  ramen: "ramen",
  noodle: "ramen",
  chinese: "chinese",
  dim_sum: "chinese",
  thai: "thai",
  vietnamese: "vietnamese",
  pho: "vietnamese",
  indian: "indian",
  curry: "indian",
  italian: "italian",
  pasta: "italian",
  pizza: "pizza",
  american: "american",
  burger: "american",
  steak_house: "american",
  diner: "american",
  wings: "american",
  barbecue: "bbq",
  bbq: "bbq",
  mediterranean: "mediterranean",
  greek: "greek",
  lebanese: "middle_eastern",
  turkish: "middle_eastern",
  kebab: "middle_eastern",
  shawarma: "middle_eastern",
  arab: "middle_eastern",
  persian: "middle_eastern",
  french: "french",
  crepe: "french",
  ethiopian: "ethiopian",
  seafood: "seafood",
  fish: "seafood",
  sandwich: "deli",
  deli: "deli",
  bagel: "deli",
  coffee_shop: "cafe",
  cafe: "cafe",
  breakfast: "cafe",
  brunch: "cafe",
  bakery: "cafe",
  salad: "salad",
};

/**
 * Words in a restaurant's own name that state its cuisine.
 *
 * Most restaurants in OpenStreetMap carry no `cuisine` tag at all — in a
 * central Boston sample, ten of thirty-five, including every landmark Italian
 * restaurant in the North End. Their names say so plainly: "Ristorante
 * Saraceno", "Terramia Ristorante", "Union Oyster House".
 *
 * This is a last resort, consulted only when the tag is absent, and it is
 * deliberately limited to words that name a cuisine outright rather than
 * merely suggest one. It is also why this stays out of the dietary path: a
 * wrong cuisine costs a ranking place, while a wrong dietary claim is a person
 * served food they cannot eat, and no name is evidence of that.
 */
const CUISINE_BY_NAME_WORD: ReadonlyArray<readonly [RegExp, Cuisine]> = [
  [/\b(ristorante|trattoria|osteria|enoteca)\b/i, "italian"],
  [/\b(pizzeria|pizzaria)\b/i, "pizza"],
  [/\b(taqueria|cantina|birrieria)\b/i, "mexican"],
  [/\b(sushi|izakaya|teriyaki)\b/i, "japanese"],
  [/\b(ramen|noodle house)\b/i, "ramen"],
  [/\b(pho|banh mi)\b/i, "vietnamese"],
  [/\b(oyster|seafood|fish house|clam|lobster)\b/i, "seafood"],
  [/\b(delicatessen|delis?)\b/i, "deli"],
  [/\b(taverna|souvlaki|gyro)\b/i, "greek"],
  [/\b(shawarma|falafel|kebab|kabob)\b/i, "middle_eastern"],
  [/\b(bbq|barbecue|barbeque|smokehouse)\b/i, "bbq"],
  [/\b(creperie|brasserie|bistro)\b/i, "french"],
  [/\b(cafe|caffe|coffee|espresso|roasters)\b/i, "cafe"],
  [/\b(curry|tandoor|masala)\b/i, "indian"],
];

export function cuisineFromOsmTags(tags: Readonly<Record<string, string>>): Cuisine {
  for (const value of (tags.cuisine ?? "").split(";")) {
    const mapped = CUISINE_BY_OSM_VALUE[value.trim().toLowerCase()];
    if (mapped) return mapped;
  }

  // `amenity=cafe` is a direct statement of the category, not an inference.
  if (tags.amenity === "cafe") return "cafe";

  const name = tags.name ?? "";
  for (const [pattern, cuisine] of CUISINE_BY_NAME_WORD) {
    if (pattern.test(name)) return cuisine;
  }

  return UNKNOWN_CUISINE;
}

/**
 * OSM's `diet:*` tags, which are the reason this provider exists: they cover
 * vegan, halal, kosher, and gluten-free, which commercial place APIs generally
 * do not publish.
 *
 * Only `yes` and `only` are accepted. `limited` is deliberately rejected —
 * every dietary requirement is a hard restriction downstream, so "a couple of
 * things on the menu" must not read as "this restaurant accommodates you".
 */
const DIET_TAGS: ReadonlyArray<readonly [string, DietaryRequirement]> = [
  ["diet:vegetarian", "vegetarian"],
  ["diet:vegan", "vegan"],
  ["diet:gluten_free", "gluten_free"],
  ["diet:halal", "halal"],
  ["diet:kosher", "kosher"],
  ["diet:dairy_free", "dairy_free"],
  ["diet:lactose_free", "dairy_free"],
];

const AFFIRMATIVE = new Set(["yes", "only"]);

/**
 * Older spellings still widely present in OpenStreetMap data. These predate
 * the `diet:*` scheme and were simply invisible before, which cost real
 * coverage in exactly the cases that matter most.
 */
const LEGACY_DIET_TAGS: ReadonlyArray<readonly [string, DietaryRequirement]> = [
  ["vegetarian", "vegetarian"],
  ["vegan", "vegan"],
];

export function accommodatesFromOsmTags(
  tags: Readonly<Record<string, string>>,
): DietaryRequirement[] {
  const accommodates = new Set<DietaryRequirement>();

  for (const [tag, requirement] of [...DIET_TAGS, ...LEGACY_DIET_TAGS]) {
    if (AFFIRMATIVE.has((tags[tag] ?? "").trim().toLowerCase())) {
      accommodates.add(requirement);
    }
  }

  // `cuisine=vegan` states what the restaurant serves; it is not the forbidden
  // step of inferring a diet from a cuisine ("Indian, so probably vegetarian").
  // A restaurant whose cuisine *is* vegan accommodates vegans by definition.
  const cuisines = (tags.cuisine ?? "").toLowerCase().split(";").map((value) => value.trim());
  if (cuisines.includes("vegan")) accommodates.add("vegan");
  if (cuisines.includes("vegetarian")) accommodates.add("vegetarian");

  // `diet:meat=no` is a statement that no meat is served.
  if ((tags["diet:meat"] ?? "").trim().toLowerCase() === "no") {
    accommodates.add("vegetarian");
  }

  // Vegan food is vegetarian food, so a vegan claim implies the weaker one.
  if (accommodates.has("vegan")) accommodates.add("vegetarian");

  return [...accommodates];
}

/**
 * OSM tags chains consistently, and `brand:wikidata` in particular is a
 * canonical brand identifier — an independent restaurant does not have one.
 * That makes it both a reliable way to detect a chain and a far better chain
 * key than a normalised display name, which can only guess from spelling.
 */
export function brandOf(tags: Readonly<Record<string, string>>): string | null {
  return tags["brand:wikidata"] ?? tags.brand ?? tags["operator:wikidata"] ?? null;
}

/**
 * A name-brand fast food or coffee chain — the thing a group asking for a
 * recommendation almost never wants to be shown.
 *
 * The brand tag does the disqualifying, not the amenity: an *unbranded*
 * `amenity=fast_food` is usually a taqueria, a food truck, or a local
 * counter-service place, which is exactly the kind of option worth offering.
 * Branded sit-down restaurants are left alone, since a regional chain someone
 * actually likes is a legitimate answer.
 */
export function isNameBrandChain(tags: Readonly<Record<string, string>>): boolean {
  const amenity = tags.amenity;
  return (amenity === "fast_food" || amenity === "cafe") && brandOf(tags) != null;
}

/**
 * How thoroughly OSM describes this place, 0–1.
 *
 * OSM publishes no ratings, so this is the closest thing to a quality signal it
 * offers: a place with a website, a phone number, opening hours, an address and
 * a cuisine is almost always a real, established business that someone cared
 * enough to document, while a bare name-and-pin is often a stub dropped on the
 * map years ago and never revisited. It is a proxy for "actually exists and is
 * run properly", not for "is good", and it is weighted accordingly.
 */
export function completenessOfOsmTags(tags: Readonly<Record<string, string>>): number {
  const signals = [
    tags.cuisine,
    tags.website ?? tags["contact:website"],
    tags.phone ?? tags["contact:phone"],
    tags.opening_hours,
    tags["addr:street"],
  ];
  return signals.filter(Boolean).length / signals.length;
}

export function websiteFromOsmTags(tags: Readonly<Record<string, string>>): string | null {
  return tags.website ?? tags["contact:website"] ?? null;
}

export function phoneFromOsmTags(tags: Readonly<Record<string, string>>): string | null {
  return tags.phone ?? tags["contact:phone"] ?? null;
}

/** Assembles a street address from OSM's split `addr:*` tags. */
export function addressFromOsmTags(tags: Readonly<Record<string, string>>): string {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  return [street, tags["addr:city"]].filter(Boolean).join(", ");
}

/**
 * Whether OpenStreetMap published any dietary information for this listing.
 *
 * Most restaurants carry none, and an empty `accommodates` therefore means
 * "unknown" far more often than "does not accommodate". The recommender needs
 * to tell those apart before it eliminates somebody's only options.
 */
export function hasDietaryData(tags: Readonly<Record<string, string>>): boolean {
  return Object.keys(tags).some(
    (key) => key.startsWith("diet:") || key === "vegetarian" || key === "vegan",
  );
}
