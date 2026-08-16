import { describe, expect, it } from "vitest";
import {
  hardConstraintsOf,
  softPreferencesOf,
  splitPreferences,
} from "@/domain/recommendations/constraints";
import {
  hardRestrictions,
  isEligibleForAll,
  memberCompatibility,
  scoreRestaurant,
} from "@/domain/recommendations/scoring";
import { hard, preference, restaurant, soft } from "../helpers/factories";

/**
 * The separation between hard constraints and soft preferences is enforced by
 * the compiler, not by convention. The block below is the assertion: every
 * `@ts-expect-error` fails `npm run typecheck` if that line ever *stops* being
 * an error, which is what would happen if someone widened a signature or made
 * the two types structurally compatible again.
 *
 * It is deliberately never called. Its whole job is to be type-checked.
 */
function _theseMustNotCompile(): void {
  const p = preference({ dietary: ["vegan"], maxPriceLevel: 2 });
  const h = hardConstraintsOf(p);
  const s = softPreferencesOf(p);
  const r = restaurant();

  // A hard constraint must never reach a scoring function. This is the whole
  // point of the split: scoring trades things off, and a dietary requirement
  // is not tradeable.
  // @ts-expect-error hard constraints are not scoreable
  memberCompatibility(r, h);
  // @ts-expect-error hard constraints are not scoreable
  scoreRestaurant(r, [h]);

  // The reverse is just as wrong: a soft preference must not eliminate anyone.
  // @ts-expect-error soft preferences are not eliminating constraints
  hardRestrictions(r, s);
  // @ts-expect-error soft preferences are not eliminating constraints
  isEligibleForAll(r, [s]);

  // And the unsplit record reaches neither. You cannot get to a scorer or a
  // filter without first stating which half of the member's answer you meant.
  // @ts-expect-error MemberPreference must be projected before scoring
  scoreRestaurant(r, [p]);
  // @ts-expect-error MemberPreference must be projected before filtering
  hardRestrictions(r, p);
}

describe("constraint projections", () => {
  it("routes each stated field to exactly one side", () => {
    const p = preference({
      preferredCuisines: ["mexican"],
      excludedCuisines: ["seafood"],
      dietary: ["vegan"],
      noPreference: false,
    });

    expect(hardConstraintsOf(p)).toMatchObject({
      kind: "hard",
      forbiddenCuisines: ["seafood"],
      requiredDiets: ["vegan"],
    });
    expect(softPreferencesOf(p)).toMatchObject({
      kind: "soft",
      preferredCuisines: ["mexican"],
      easygoing: false,
    });
  });

  it("gives the dual-use price and distance fields to both sides, in agreement", () => {
    // Price and distance both eliminate and shape comfort. If the two
    // projections ever disagreed, a restaurant could be filtered against one
    // number and scored against another — silently, and only for some members.
    const p = preference({ maxPriceLevel: 3, maxDistanceMiles: 2.5 });

    expect(hardConstraintsOf(p).priceCeiling).toBe(softPreferencesOf(p).priceComfortCeiling);
    expect(hardConstraintsOf(p).distanceLimit).toBe(softPreferencesOf(p).distanceHorizon);
    expect(hardConstraintsOf(p).priceCeiling).toBe(3);
    expect(hardConstraintsOf(p).distanceLimit).toBe(2.5);
  });

  it("keeps both halves in member order so a violation is attributable", () => {
    const group = [
      preference({ dietary: ["vegan"], preferredCuisines: ["thai"] }),
      preference({ maxPriceLevel: 1 }),
      preference({ noPreference: true }),
    ];
    const { hard: hardSide, soft: softSide } = splitPreferences(group);

    expect(hardSide).toHaveLength(3);
    expect(softSide).toHaveLength(3);
    expect(hardSide[0]?.requiredDiets).toEqual(["vegan"]);
    expect(softSide[0]?.preferredCuisines).toEqual(["thai"]);
    expect(hardSide[1]?.priceCeiling).toBe(1);
    expect(softSide[2]?.easygoing).toBe(true);
  });

  it("carries no stated field into a side that would misuse it", () => {
    // An easygoing member constrains nothing; a member with only a dietary
    // need expresses no ranking opinion. Each side stays empty where it should.
    expect(hardConstraintsOf(preference({ noPreference: true }))).toMatchObject({
      forbiddenCuisines: [],
      requiredDiets: [],
      priceCeiling: null,
      distanceLimit: null,
    });
    expect(softPreferencesOf(preference({ dietary: ["halal"] }))).toMatchObject({
      preferredCuisines: [],
      easygoing: false,
    });
  });

  it("still eliminates and still ranks, through the split", () => {
    const target = restaurant({ cuisine: "seafood", priceLevel: 4 });

    expect(hardRestrictions(target, hard({ excludedCuisines: ["seafood"] }))).toHaveLength(1);
    expect(isEligibleForAll(target, [hard({ maxPriceLevel: 2 })])).toBe(false);
    expect(memberCompatibility(target, soft({ preferredCuisines: ["seafood"] }))).toBeGreaterThan(
      memberCompatibility(target, soft({ preferredCuisines: ["mexican"] })),
    );
  });
});
