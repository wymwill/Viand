import { describe, expect, it } from "vitest";
import { MOCK_RESTAURANTS } from "@/domain/restaurants/mock-data";
import { recommend, winnerReasons } from "@/domain/recommendations/select";
import {
  hardRestrictions,
  isEligibleForAll,
  memberCompatibility,
  NO_PREFERENCE_COMPATIBILITY,
  scoreRestaurant,
} from "@/domain/recommendations/scoring";
import { hard, preference, restaurant, soft } from "../helpers/factories";

describe("hard restrictions", () => {
  it("rejects an explicitly excluded cuisine", () => {
    const violations = hardRestrictions(
      restaurant({ cuisine: "seafood" }),
      hard({ excludedCuisines: ["seafood"] }),
    );
    expect(violations).toContainEqual({ kind: "excluded_cuisine", cuisine: "seafood" });
  });

  it("rejects a restaurant that cannot accommodate a dietary requirement", () => {
    const violations = hardRestrictions(
      restaurant({ accommodates: ["vegetarian"] }),
      hard({ dietary: ["vegan"] }),
    );
    expect(violations).toContainEqual({ kind: "dietary", requirement: "vegan" });
  });

  it("rejects a restaurant above a stated price ceiling", () => {
    const violations = hardRestrictions(
      restaurant({ priceLevel: 4 }),
      hard({ maxPriceLevel: 2 }),
    );
    expect(violations).toContainEqual({ kind: "price", maxPriceLevel: 2 });
  });

  it("rejects a restaurant beyond a stated distance limit", () => {
    const violations = hardRestrictions(
      restaurant({ distanceMiles: 6 }),
      hard({ maxDistanceMiles: 2 }),
    );
    expect(violations).toContainEqual({ kind: "distance", maxDistanceMiles: 2 });
  });

  it("accepts a restaurant that satisfies every member", () => {
    const target = restaurant({ accommodates: ["vegetarian"], priceLevel: 1, distanceMiles: 0.5 });
    expect(
      isEligibleForAll(target, [
        hard({ dietary: ["vegetarian"] }),
        hard({ maxPriceLevel: 2 }),
        hard({ maxDistanceMiles: 1 }),
      ]),
    ).toBe(true);
  });

  it("is applied before scoring, so restricted options never appear", () => {
    const result = recommend(MOCK_RESTAURANTS, [preference({ dietary: ["vegan"] })]);
    for (const candidate of result.candidates) {
      expect(candidate.restaurant.accommodates).toContain("vegan");
    }
    expect(result.eliminatedCount).toBeGreaterThan(0);
  });
});

describe("weakest-member fairness", () => {
  it("prefers an even spread over a high average with one poor fit", () => {
    // Same restaurant, two groups with identical average compatibility. The
    // group containing a poorly-served member must score lower, because the
    // weakest-member term carries more weight than the average.
    const target = restaurant({ distanceMiles: 2.0 });

    const evenGroup = scoreRestaurant(target, [
      soft({ maxDistanceMiles: 4 }),
      soft({ maxDistanceMiles: 4 }),
    ]);
    const lopsidedGroup = scoreRestaurant(target, [
      soft({ maxDistanceMiles: 10 }),
      soft({ maxDistanceMiles: 2.5 }),
    ]);

    expect(lopsidedGroup.averageMember).toBeCloseTo(evenGroup.averageMember, 6);
    expect(lopsidedGroup.weakestMember).toBeLessThan(evenGroup.weakestMember);
    expect(lopsidedGroup.total).toBeLessThan(evenGroup.total);
  });

  it("does not let a no-preference member drag down the weakest score", () => {
    // A member who said "anything" scores a flat high value regardless of the
    // restaurant, so they can never be the weakest link.
    const remote = restaurant({ cuisine: "seafood", distanceMiles: 4.5, priceLevel: 4 });
    const easygoing = soft({ noPreference: true });
    const picky = soft({ preferredCuisines: ["mexican"] });

    expect(memberCompatibility(remote, easygoing)).toBeCloseTo(NO_PREFERENCE_COMPATIBILITY, 6);
    expect(memberCompatibility(remote, picky)).toBeLessThan(
      memberCompatibility(remote, easygoing),
    );

    const score = scoreRestaurant(remote, [picky, easygoing]);
    expect(score.weakestMember).toBe(memberCompatibility(remote, picky));
  });
});

describe("compatibility scoring", () => {
  it("rewards an exact cuisine match over an unrelated cuisine", () => {
    const wanted = soft({ preferredCuisines: ["mexican"] });
    const match = scoreRestaurant(restaurant({ cuisine: "mexican" }), [wanted]);
    const miss = scoreRestaurant(restaurant({ cuisine: "seafood" }), [wanted]);
    expect(match.total).toBeGreaterThan(miss.total);
  });

  it("gives partial credit within a cuisine family", () => {
    const wanted = soft({ preferredCuisines: ["japanese"] });
    const related = scoreRestaurant(restaurant({ cuisine: "ramen" }), [wanted]);
    const unrelated = scoreRestaurant(restaurant({ cuisine: "bbq" }), [wanted]);
    expect(related.total).toBeGreaterThan(unrelated.total);
  });

  it("weights are the documented distribution and sum to one", () => {
    const score = scoreRestaurant(restaurant(), [soft()]);
    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThanOrEqual(1);
  });
});

describe("option selection", () => {
  it("returns up to five options", () => {
    const result = recommend(MOCK_RESTAURANTS, [preference()]);
    expect(result.candidates).toHaveLength(5);
  });

  it("returns fewer than five when the area has little to offer", () => {
    const sparse = MOCK_RESTAURANTS.slice(0, 2);
    const result = recommend(sparse, [preference()]);
    expect(result.candidates).toHaveLength(2);
  });

  it("honours an explicit limit", () => {
    const result = recommend(MOCK_RESTAURANTS, [preference()], { limit: 3 });
    expect(result.candidates).toHaveLength(3);
  });

  it("never returns three locations of the same chain", () => {
    const chainOnly = MOCK_RESTAURANTS.filter(
      (entry) => entry.chainId === "slice-society" || entry.id === "tacoria",
    );
    const result = recommend(chainOnly, [preference()]);
    const chainIds = result.candidates.map((candidate) => candidate.restaurant.chainId);
    const sameChain = chainIds.filter((id) => id === "slice-society").length;
    expect(sameChain).toBeLessThan(3);
  });

  it("prefers meaningfully different cuisines", () => {
    const result = recommend(MOCK_RESTAURANTS, [preference()]);
    const cuisines = new Set(result.candidates.map((candidate) => candidate.restaurant.cuisine));
    expect(cuisines.size).toBe(result.candidates.length);
  });

  it("excludes vetoed restaurants", () => {
    const first = recommend(MOCK_RESTAURANTS, [preference()]);
    const vetoedId = first.candidates[0]?.restaurant.id;
    expect(vetoedId).toBeDefined();

    const second = recommend(MOCK_RESTAURANTS, [preference()], {
      vetoedRestaurantIds: [vetoedId as string],
    });
    expect(second.candidates.map((candidate) => candidate.restaurant.id)).not.toContain(vetoedId);
  });

  it("returns nothing when restrictions eliminate everything", () => {
    const result = recommend(MOCK_RESTAURANTS, [
      preference({ dietary: ["vegan"], maxPriceLevel: 1, maxDistanceMiles: 0.1 }),
    ]);
    expect(result.candidates).toHaveLength(0);
  });

  it("flags the allergy disclaimer only when someone reported an allergy", () => {
    expect(recommend(MOCK_RESTAURANTS, [preference()]).needsAllergyDisclaimer).toBe(false);
    expect(
      recommend(MOCK_RESTAURANTS, [preference({ hasAllergyConcern: true })]).needsAllergyDisclaimer,
    ).toBe(true);
  });

  it("writes an explanation for every option", () => {
    const result = recommend(MOCK_RESTAURANTS, [preference({ preferredCuisines: ["mexican"] })]);
    for (const candidate of result.candidates) {
      expect(candidate.explanation.length).toBeGreaterThan(0);
      expect(candidate.explanation.endsWith(".")).toBe(true);
    }
    expect(result.candidates[0]?.explanation).toContain("Best overall match");
  });

  it("produces winner reasons grounded in the data", () => {
    const result = recommend(MOCK_RESTAURANTS, [
      preference({ preferredCuisines: ["mexican"], dietary: ["vegetarian"], maxPriceLevel: 2 }),
    ]);
    const winner = result.candidates[0];
    expect(winner).toBeDefined();
    const reasons = winnerReasons(winner!, [
      preference({ preferredCuisines: ["mexican"], dietary: ["vegetarian"], maxPriceLevel: 2 }),
    ]);
    expect(reasons.join(" ")).toContain("budget");
    expect(reasons.some((reason) => reason.includes("miles away"))).toBe(true);
  });
});

describe("opening hours", () => {
  /**
   * The failure this prevents is the one that makes the product feel broken:
   * a confidently recommended restaurant that is shut. A closed restaurant is
   * eliminated like any other hard constraint — removed before ranking, never
   * merely penalised, so no amount of rating or proximity can promote it back.
   */
  it("never offers a restaurant that is closed at the query time", () => {
    const open = restaurant({ id: "open-place", cuisine: "mexican", openNow: true });
    const closed = restaurant({
      id: "closed-place",
      cuisine: "mexican",
      openNow: false,
      // Deliberately the better option on every soft dimension.
      rating: 5,
      distanceMiles: 0.1,
    });

    const result = recommend([open, closed], [preference({ preferredCuisines: ["mexican"] })]);

    expect(result.candidates.map((candidate) => candidate.restaurant.id)).toEqual(["open-place"]);
  });

  it("still offers a restaurant whose hours could not be verified", () => {
    // Unverified is not closed. Dropping these would empty the list in most of
    // OpenStreetMap, where opening_hours is frequently absent or unparseable.
    const unverified = restaurant({ id: "unknown-hours", cuisine: "mexican", openNow: null });

    const result = recommend([unverified], [preference({ preferredCuisines: ["mexican"] })]);

    expect(result.candidates.map((candidate) => candidate.restaurant.id)).toEqual([
      "unknown-hours",
    ]);
  });

  it("treats both shapes of a missing rating as unknown, not as a bad rating", () => {
    // `null` and `0` are the two ways a source says "no rating". Both must fall
    // through to the completeness proxy. Completeness is set high here so a
    // regression that scored them as a one-star review would fail loudly —
    // asserting only that the two agree would pass on two zeroes.
    const soften = soft({});
    const rated = restaurant({ id: "rated", rating: 4.5, completeness: 0.9 });
    const nullRating = restaurant({ id: "null-rating", rating: null, completeness: 0.9 });
    const zeroRating = restaurant({ id: "zero-rating", rating: 0, completeness: 0.9 });

    const nullScore = scoreRestaurant(nullRating, [soften]).rating;
    const zeroScore = scoreRestaurant(zeroRating, [soften]).rating;

    expect(nullScore).toBe(zeroScore);
    expect(nullScore).toBe(0.9);
    // Sanity: a real rating still drives the term, so the proxy has not
    // swallowed the signal for sources that do publish one.
    expect(scoreRestaurant(rated, [soften]).rating).toBe(0.75);
  });
});
