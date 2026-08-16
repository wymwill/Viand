import {
  ALLERGY_REQUIREMENTS,
  CUISINES,
  CUISINE_FAMILIES,
  DIETARY_REQUIREMENTS,
  UNKNOWN_CUISINE,
  emptyPreference,
  type Cuisine,
  type DietaryRequirement,
  type MemberPreference,
  type PriceLevel,
} from "@/domain/types";
import { Rng } from "./rng";

/**
 * The synthetic corpus.
 *
 * The design point that makes this eval worth running: each member has a
 * **latent utility vector** that no strategy ever sees, and their *stated*
 * preference is a lossy projection of it. Satisfaction is scored against the
 * latent vector.
 *
 * Without that separation the eval would be circular — measuring the
 * deterministic scorer with the deterministic scorer's own objective would
 * make it win by definition and tell us nothing. Here every strategy sees the
 * same partial information and is graded on what the member actually wanted.
 *
 * The loss is concentrated where it is in real life: people name one or two
 * cuisines, not a ranking over twenty-one, and they never mention that they'd
 * have been fine with the adjacent one.
 */

export type LatentHardConstraint =
  | { kind: "diet"; requirement: DietaryRequirement }
  | { kind: "excluded_cuisine"; cuisine: Cuisine }
  | { kind: "price_cap"; maxPriceLevel: PriceLevel }
  | { kind: "distance_cap"; maxMiles: number };

export interface LatentMember {
  /** Utility of each cuisine to this member, 0–1. The thing we grade against. */
  cuisineUtility: Record<Cuisine, number>;
  idealPriceLevel: PriceLevel;
  /** Utility lost per price level above the ideal. */
  pricePenalty: number;
  /** Miles at which distance utility reaches zero. */
  distanceTolerance: number;
  easygoing: boolean;
  hardConstraint: LatentHardConstraint | null;
}

export interface EvalMember {
  id: string;
  latent: LatentMember;
  /** What the member told Viand. A lossy projection of `latent`. */
  stated: MemberPreference;
  /** The same thing in prose, for the unstructured-prompt strategy. */
  sentence: string;
}

export interface EvalGroup {
  id: string;
  members: EvalMember[];
}

const ALL_CUISINES: readonly Cuisine[] = [...CUISINES, UNKNOWN_CUISINE];

/** Baseline utility of a cuisine nobody asked for. Not zero: people do eat. */
const INDIFFERENT_UTILITY = 0.15;
const FAMILY_UTILITY = 0.6;
const EASYGOING_UTILITY = 0.7;

const PROBABILITY_EASYGOING = 0.2;
const PROBABILITY_HARD_CONSTRAINT = 0.4;
/** Chance a member mentions a cuisine they love beyond their first. */
const PROBABILITY_MENTION_EXTRA_CUISINE = 0.5;

function familyOf(cuisine: Cuisine): Cuisine[] {
  const related = new Set<Cuisine>();
  for (const family of CUISINE_FAMILIES) {
    if (family.includes(cuisine)) {
      for (const member of family) if (member !== cuisine) related.add(member);
    }
  }
  return [...related];
}

function buildUtility(loved: readonly Cuisine[], easygoing: boolean): Record<Cuisine, number> {
  const utility = {} as Record<Cuisine, number>;
  for (const cuisine of ALL_CUISINES) {
    utility[cuisine] = easygoing ? EASYGOING_UTILITY : INDIFFERENT_UTILITY;
  }
  if (easygoing) return utility;

  // Adjacency first, so a loved cuisine that is also adjacent to another loved
  // one still ends at 1.0 rather than being overwritten down to 0.6.
  for (const cuisine of loved) {
    for (const relative of familyOf(cuisine)) {
      utility[relative] = Math.max(utility[relative], FAMILY_UTILITY);
    }
  }
  for (const cuisine of loved) utility[cuisine] = 1;

  return utility;
}

function drawHardConstraint(rng: Rng, loved: readonly Cuisine[]): LatentHardConstraint | null {
  if (!rng.bool(PROBABILITY_HARD_CONSTRAINT)) return null;

  switch (rng.int(1, 4)) {
    case 1:
      return { kind: "diet", requirement: rng.pick(DIETARY_REQUIREMENTS) };
    case 2: {
      // Never exclude something they love; that member would be incoherent.
      const candidates = CUISINES.filter((cuisine) => !loved.includes(cuisine));
      return { kind: "excluded_cuisine", cuisine: rng.pick(candidates) };
    }
    case 3:
      return { kind: "price_cap", maxPriceLevel: rng.int(1, 3) as PriceLevel };
    default:
      return { kind: "distance_cap", maxMiles: rng.round(0.5, 3, 1) };
  }
}

const CUISINE_WORDS: Partial<Record<Cuisine, string>> = {
  middle_eastern: "middle eastern",
  bbq: "barbecue",
  cafe: "a cafe",
  salad: "something light",
  deli: "a deli",
};

function cuisineWord(cuisine: Cuisine): string {
  return CUISINE_WORDS[cuisine] ?? cuisine;
}

const DIET_WORDS: Record<DietaryRequirement, string> = {
  vegetarian: "vegetarian",
  vegan: "vegan",
  gluten_free: "gluten-free",
  halal: "halal",
  kosher: "kosher",
  dairy_free: "dairy-free",
  nut_free: "nut-free",
  shellfish_free: "shellfish-free",
};

/**
 * Prose for the unstructured-prompt strategy. Assembled from the *stated*
 * preference, never the latent vector, so strategy (b) gets exactly the
 * information the other two get — just unparsed.
 */
function writeSentence(rng: Rng, stated: MemberPreference, latent: LatentMember): string {
  const parts: string[] = [];

  if (stated.noPreference) {
    parts.push(rng.pick(["I'm easy", "anything works for me", "I don't mind"]));
  } else if (stated.preferredCuisines.length > 0) {
    const wanted = stated.preferredCuisines.map(cuisineWord).join(" or ");
    parts.push(rng.pick([`I'd love ${wanted}`, `${wanted} sounds good`, `I'm craving ${wanted}`]));
  } else {
    parts.push(rng.pick(["no strong feelings on food", "whatever the group wants"]));
  }

  const [firstDiet] = stated.dietary;
  if (firstDiet) {
    const word = DIET_WORDS[firstDiet];
    parts.push(
      stated.hasAllergyConcern
        ? `I have a ${word.replace("-free", "")} allergy so it has to be ${word}`
        : `it needs to be ${word}`,
    );
  }

  const [firstExcluded] = stated.excludedCuisines;
  if (firstExcluded) parts.push(`no ${cuisineWord(firstExcluded)} though`);

  if (stated.maxPriceLevel != null) {
    parts.push(rng.pick([`nothing over ${"$".repeat(stated.maxPriceLevel)}`, "keep it cheap"]));
  }

  if (stated.maxDistanceMiles != null) {
    parts.push(`within ${stated.maxDistanceMiles} miles`);
  }

  // A hint of the latent price ideal, without stating it as a limit — the kind
  // of signal a parser drops and a language model might pick up.
  if (stated.maxPriceLevel == null && latent.idealPriceLevel <= 2 && rng.bool(0.3)) {
    parts.push("nothing fancy");
  }

  return `${parts.join(", ")}.`;
}

function stateFrom(latent: LatentMember, loved: readonly Cuisine[], rng: Rng): MemberPreference {
  const stated = emptyPreference("");

  if (latent.easygoing) {
    stated.noPreference = true;
  } else {
    // Lossy on purpose: the first loved cuisine is always mentioned, the rest
    // only sometimes, and the 0.6-utility neighbours never are.
    const mentioned = loved.filter((_, index) => index === 0 || rng.bool(PROBABILITY_MENTION_EXTRA_CUISINE));
    stated.preferredCuisines = [...mentioned];
  }

  const constraint = latent.hardConstraint;
  if (constraint) {
    switch (constraint.kind) {
      case "diet":
        stated.dietary = [constraint.requirement];
        break;
      case "excluded_cuisine":
        stated.excludedCuisines = [constraint.cuisine];
        break;
      case "price_cap":
        stated.maxPriceLevel = constraint.maxPriceLevel;
        break;
      case "distance_cap":
        stated.maxDistanceMiles = constraint.maxMiles;
        break;
    }
  }

  stated.hasAllergyConcern = stated.dietary.some((requirement) =>
    ALLERGY_REQUIREMENTS.includes(requirement),
  );

  return stated;
}

function generateMember(rng: Rng, id: string): EvalMember {
  const easygoing = rng.bool(PROBABILITY_EASYGOING);
  const loved = easygoing ? [] : rng.sample(CUISINES, rng.int(1, 3));

  const latent: LatentMember = {
    cuisineUtility: buildUtility(loved, easygoing),
    idealPriceLevel: rng.int(1, 3) as PriceLevel,
    pricePenalty: rng.round(0.1, 0.3, 2),
    distanceTolerance: easygoing ? rng.round(3, 6, 1) : rng.round(0.5, 5, 1),
    easygoing,
    hardConstraint: drawHardConstraint(rng, loved),
  };

  const stated = stateFrom(latent, loved, rng);
  const sentence = writeSentence(rng, stated, latent);
  stated.originalMessage = sentence;

  return { id, latent, stated, sentence };
}

export interface GenerateOptions {
  seed: number;
  groupCount: number;
  minSize?: number;
  maxSize?: number;
}

export function generateGroups(rng: Rng, options: GenerateOptions): EvalGroup[] {
  const minSize = options.minSize ?? 2;
  const maxSize = options.maxSize ?? 6;
  const groups: EvalGroup[] = [];

  for (let g = 0; g < options.groupCount; g += 1) {
    const size = rng.int(minSize, maxSize);
    const members: EvalMember[] = [];
    for (let m = 0; m < size; m += 1) {
      members.push(generateMember(rng, `g${g}m${m}`));
    }
    groups.push({ id: `group-${String(g).padStart(2, "0")}`, members });
  }

  return groups;
}
