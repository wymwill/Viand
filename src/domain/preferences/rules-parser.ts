import {
  ALLERGY_REQUIREMENTS,
  emptyPreference,
  type Cuisine,
  type DietaryRequirement,
  type MemberPreference,
  type PriceLevel,
} from "../types";
import type { PreferenceParser } from "./parser";
import {
  BUDGET_PHRASES,
  CUISINE_PHRASES,
  DIETARY_PHRASES,
  NEGATION_MARKERS,
  NO_PREFERENCE_PHRASES,
} from "./vocabulary";

/**
 * Urban-driving assumption converting a stated travel time into the miles the
 * restaurant provider actually filters on. 3 min/mile is roughly 20 mph.
 */
export const MINUTES_PER_MILE = 3;

/**
 * How many words a negation marker reaches forward. Keeps "no seafood, mexican
 * is great" from excluding mexican while still catching "anything except sushi
 * or ramen".
 */
const NEGATION_REACH_WORDS = 4;

function lower(raw: string): string {
  return raw.toLowerCase().replace(/[‘’']/g, "");
}

/** Splits on sentence punctuation and on "but", which flips polarity mid-sentence. */
function toClauses(loweredText: string): string[] {
  return loweredText
    .split(/[,;.!?]|\bbut\b/)
    .map((clause) => clause.replace(/[^a-z0-9]+/g, " ").trim())
    .filter((clause) => clause.length > 0);
}

/** Index of `needle` in `haystack` at word boundaries, or -1. */
function indexOfWord(haystack: string, needle: string, from = 0): number {
  let at = haystack.indexOf(needle, from);
  while (at !== -1) {
    const beforeOk = at === 0 || haystack[at - 1] === " ";
    const afterIndex = at + needle.length;
    const afterOk = afterIndex === haystack.length || haystack[afterIndex] === " ";
    if (beforeOk && afterOk) return at;
    at = haystack.indexOf(needle, at + 1);
  }
  return -1;
}

function wordsBetween(clause: string, fromIndex: number, toIndex: number): number {
  if (toIndex <= fromIndex) return 0;
  const span = clause.slice(fromIndex, toIndex).trim();
  return span.length === 0 ? 0 : span.split(/\s+/).length;
}

/**
 * True when a negation marker sits close enough before `hitIndex` to be talking
 * about it.
 */
function isNegated(clause: string, hitIndex: number): boolean {
  for (const marker of NEGATION_MARKERS) {
    let at = indexOfWord(clause, marker);
    while (at !== -1 && at < hitIndex) {
      const markerEnd = at + marker.length;
      if (markerEnd <= hitIndex && wordsBetween(clause, markerEnd, hitIndex) <= NEGATION_REACH_WORDS) {
        return true;
      }
      at = indexOfWord(clause, marker, at + 1);
    }
  }
  return false;
}

interface PhraseHit<T> {
  value: T;
  index: number;
  negated: boolean;
}

/**
 * Finds every phrase in `clause`, blanking each match so a longer phrase that
 * already consumed the text cannot be re-matched by a shorter one.
 */
function findPhrases<T, Extra>(
  clause: string,
  phrases: ReadonlyArray<readonly [string, T, Extra?]>,
): Array<PhraseHit<T> & { extra: Extra | undefined }> {
  const hits: Array<PhraseHit<T> & { extra: Extra | undefined }> = [];
  let remaining = clause;

  for (const [phrase, value, extra] of phrases) {
    let at = indexOfWord(remaining, phrase);
    while (at !== -1) {
      hits.push({ value, index: at, negated: isNegated(clause, at), extra });
      remaining = remaining.slice(0, at) + " ".repeat(phrase.length) + remaining.slice(at + phrase.length);
      at = indexOfWord(remaining, phrase);
    }
  }

  return hits;
}

function dollarsToLevel(dollars: number): PriceLevel {
  if (dollars <= 15) return 1;
  if (dollars <= 25) return 2;
  if (dollars <= 40) return 3;
  return 4;
}

const CEILING = "(?:under|below|less than|max|maximum|up to|no more than|within)";

function parseMaxPriceLevel(loweredText: string): PriceLevel | null {
  const levels: PriceLevel[] = [];

  // Bare dollar signs: "$$" means "$$ or cheaper". Excluded when followed by a
  // digit so "$25" falls through to the numeric rules below.
  for (const match of loweredText.matchAll(/(?:^|\s)(\$+)(?!\d)/g)) {
    const run = match[1];
    if (run) levels.push(Math.min(run.length, 4) as PriceLevel);
  }

  for (const match of loweredText.matchAll(new RegExp(`${CEILING}\\s*\\$?\\s*(\\d{1,3})\\b`, "g"))) {
    const dollars = Number(match[1]);
    // "within 15 minutes" is distance, not money — skip when a time unit follows.
    if (/^\s*(?:minutes|minute|mins|min|miles|mile|mi)\b/.test(loweredText.slice(match.index + match[0].length))) {
      continue;
    }
    if (Number.isFinite(dollars)) levels.push(dollarsToLevel(dollars));
  }

  for (const match of loweredText.matchAll(/\$?(\d{1,3})\s*(?:or less|or under|or cheaper)\b/g)) {
    const dollars = Number(match[1]);
    if (Number.isFinite(dollars)) levels.push(dollarsToLevel(dollars));
  }

  for (const [phrase, level] of BUDGET_PHRASES) {
    if (indexOfWord(loweredText.replace(/[^a-z0-9$ ]+/g, " "), phrase) !== -1) levels.push(level);
  }

  if (levels.length === 0) return null;
  return Math.min(...levels) as PriceLevel;
}

function parseMaxDistanceMiles(loweredText: string): number | null {
  const miles: number[] = [];

  for (const match of loweredText.matchAll(/(\d{1,3})\s*(?:minutes|minute|mins|min)\b/g)) {
    const minutes = Number(match[1]);
    if (Number.isFinite(minutes)) miles.push(minutes / MINUTES_PER_MILE);
  }

  for (const match of loweredText.matchAll(/(\d{1,2}(?:\.\d)?)\s*(?:miles|mile|mi)\b/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) miles.push(value);
  }

  if (/walking distance|walkable|on foot/.test(loweredText)) miles.push(0.5);

  if (miles.length === 0) return null;
  return Math.min(...miles);
}

/**
 * Deterministic, dependency-free preference extraction. Every field is derived
 * from the vocabulary tables; the caller keeps `originalMessage` verbatim so a
 * later LLM parser can be back-tested against the same inputs.
 */
export function parsePreference(message: string): MemberPreference {
  const preference = emptyPreference(message);
  const loweredText = lower(message);
  const clauses = toClauses(loweredText);

  const preferred = new Set<Cuisine>();
  const excluded = new Set<Cuisine>();
  const dietary = new Set<DietaryRequirement>();
  let allergyTagged = false;

  for (const clause of clauses) {
    for (const hit of findPhrases<Cuisine, undefined>(clause, CUISINE_PHRASES)) {
      if (hit.negated) excluded.add(hit.value);
      else preferred.add(hit.value);
    }

    for (const hit of findPhrases<DietaryRequirement, "allergy" | "choice">(clause, DIETARY_PHRASES)) {
      if (hit.negated && hit.extra !== "allergy") continue;
      dietary.add(hit.value);
      if (hit.extra === "allergy") allergyTagged = true;
    }
  }

  // An excluded cuisine always wins over a same-message preference for it.
  for (const cuisine of excluded) preferred.delete(cuisine);

  preference.preferredCuisines = [...preferred];
  preference.excludedCuisines = [...excluded];
  preference.dietary = [...dietary];
  preference.maxPriceLevel = parseMaxPriceLevel(loweredText);
  preference.maxDistanceMiles = parseMaxDistanceMiles(loweredText);

  const flattened = loweredText.replace(/[^a-z0-9]+/g, " ").trim();
  preference.noPreference =
    preference.preferredCuisines.length === 0 &&
    NO_PREFERENCE_PHRASES.some((phrase) => indexOfWord(flattened, phrase) !== -1);

  // Err toward showing the disclaimer: any requirement that is commonly an
  // allergy counts, not only wording we could positively identify as one.
  preference.hasAllergyConcern =
    allergyTagged ||
    /\ballerg/.test(loweredText) ||
    preference.dietary.some((requirement) => ALLERGY_REQUIREMENTS.includes(requirement));

  return preference;
}

export class RulesPreferenceParser implements PreferenceParser {
  async parse(message: string): Promise<MemberPreference> {
    return parsePreference(message);
  }
}
