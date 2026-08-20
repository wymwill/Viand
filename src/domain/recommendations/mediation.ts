import { CUISINE_FAMILIES, type Cuisine, type MemberPreference } from "../types";

/**
 * Proposing one cuisine when a group has asked for several.
 *
 * The scorer cannot resolve this. `cuisineScore` awards 1.0 for an exact match,
 * 0.85 within a family and 0.35 otherwise, so when two members want cuisines
 * with no family path — Korean and Italian, say — every option scores about
 * 0.54 for whoever it fails. The least-satisfied term goes flat, totals collapse
 * to within a couple of hundredths, and the ordering falls to distance. The
 * group is not offered a compromise; it is offered four of one cuisine and one
 * of the other, and which one wins is an accident of what happens to be nearby.
 *
 * What is missing is knowledge the table does not hold: that two cuisines might
 * meet at a third. That is a judgement about food, not about arithmetic, which
 * is why it is a port — the domain states the question and the shape of an
 * acceptable answer, and something outside decides.
 */

export interface CuisineMediationRequest {
  /** Distinct cuisines the group actually asked for. */
  readonly wanted: readonly Cuisine[];
  /** Cuisines that exist among the candidates. A proposal outside this is useless. */
  readonly available: readonly Cuisine[];
}

export interface CuisineMediator {
  /**
   * Returns a cuisine both camps might accept, or null.
   *
   * Null is a first-class answer: no compromise exists, the model was
   * unavailable, or it proposed something not on the table. Every one of those
   * means the group sees exactly what it would have seen before.
   */
  propose(request: CuisineMediationRequest): Promise<Cuisine | null>;
}

function sharesFamily(a: Cuisine, b: Cuisine): boolean {
  return CUISINE_FAMILIES.some((family) => family.includes(a) && family.includes(b));
}

/** Distinct cuisines this group asked for, in first-stated order. */
export function statedCuisines(preferences: readonly MemberPreference[]): Cuisine[] {
  const seen = new Set<Cuisine>();
  for (const preference of preferences) {
    for (const cuisine of preference.preferredCuisines) seen.add(cuisine);
  }
  return [...seen];
}

/**
 * Whether the group is split in a way the scorer cannot bridge.
 *
 * Two cuisines in the same family already rank well against each other, so
 * proposing a compromise there would spend a model call to change nothing. The
 * split only matters when some pair has no path between them at all.
 */
export function isSplitOnCuisine(preferences: readonly MemberPreference[]): boolean {
  const wanted = statedCuisines(preferences);
  if (wanted.length < 2) return false;

  return wanted.some((a, index) =>
    wanted.slice(index + 1).some((b) => !sharesFamily(a, b)),
  );
}
