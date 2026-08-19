import { describe, expect, it } from "vitest";
import { hardRestrictions, memberCompatibility, SCORE_WEIGHTS, scoreRestaurant } from "@/domain/recommendations/scoring";
import { hardConstraintsOf, softPreferencesOf } from "@/domain/recommendations/constraints";
import { recommend } from "@/domain/recommendations/select";
import type { Restaurant } from "@/domain/restaurants/provider";
import { CUISINES, type Cuisine, type MemberPreference, type PriceLevel } from "@/domain/types";
import { Rng } from "../../scripts/eval/rng";
import { preference, restaurant } from "../helpers/factories";

/**
 * Viand aggregates several people's preferences into one choice, which makes it
 * a social choice rule, not a search ranking. Rules like that are judged by the
 * properties they satisfy for *every* input, not by how good one example looks
 * — a rule can produce sensible answers on the cases you thought to try and
 * still quietly privilege whoever spoke first.
 *
 * So these generate inputs rather than enumerate them, and assert the
 * properties the product claims. The generator is seeded, so a failure names a
 * seed that reproduces it exactly.
 */

const CASES = 300;
const SEED = 20260818;

function randomRestaurant(rng: Rng, id: number): Restaurant {
  return restaurant({
    id: `r-${id}`,
    cuisine: rng.pick([...CUISINES]) as Cuisine,
    priceLevel: rng.int(1, 4) as PriceLevel,
    rating: rng.bool(0.8) ? rng.round(2.5, 5, 1) : null,
    distanceMiles: rng.round(0.1, 5, 2),
    accommodates: [],
  });
}

function randomPreference(rng: Rng): MemberPreference {
  return preference({
    preferredCuisines: rng.bool(0.6) ? [rng.pick([...CUISINES]) as Cuisine] : [],
    excludedCuisines: rng.bool(0.25) ? [rng.pick([...CUISINES]) as Cuisine] : [],
    maxPriceLevel: rng.bool(0.4) ? (rng.int(1, 4) as PriceLevel) : null,
    maxDistanceMiles: rng.bool(0.4) ? rng.round(0.5, 5, 1) : null,
    noPreference: rng.bool(0.1),
  });
}

function scenario(rng: Rng) {
  const restaurants = Array.from({ length: rng.int(4, 14) }, (_, index) =>
    randomRestaurant(rng, index),
  );
  const preferences = Array.from({ length: rng.int(1, 5) }, () => randomPreference(rng));
  return { restaurants, preferences };
}

describe("the aggregation rule, over generated inputs", () => {
  it("weights a complete objective — they sum to one", () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("produces scores inside [0, 1] for every component", () => {
    const rng = new Rng(SEED);
    for (let index = 0; index < CASES; index += 1) {
      const { restaurants, preferences } = scenario(rng);
      const soft = preferences.map(softPreferencesOf);
      for (const place of restaurants) {
        for (const value of Object.values(scoreRestaurant(place, soft))) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  /**
   * Anonymity. The rule must not care which order people happened to speak in;
   * if it did, the first person to answer would quietly outrank the rest.
   */
  it("is anonymous — reordering the group cannot change the outcome", () => {
    const rng = new Rng(SEED + 1);
    for (let index = 0; index < CASES; index += 1) {
      const { restaurants, preferences } = scenario(rng);
      const reversed = [...preferences].reverse();

      const first = recommend(restaurants, preferences).candidates.map((c) => c.restaurant.id);
      const second = recommend(restaurants, reversed).candidates.map((c) => c.restaurant.id);

      expect(second).toEqual(first);
    }
  });

  it("is deterministic — identical input gives identical output", () => {
    const rng = new Rng(SEED + 2);
    for (let index = 0; index < CASES; index += 1) {
      const { restaurants, preferences } = scenario(rng);
      expect(recommend(restaurants, preferences)).toEqual(recommend(restaurants, preferences));
    }
  });

  /**
   * The product thesis, as a case the rule can actually get wrong.
   *
   * Two earlier attempts at this test were worthless. The first compared the
   * weights to each other, which is a tautology. The second generated random
   * groups and asserted the pick was never beaten on the worst-served member
   * for free — true, but the generator never produced a case where mean and
   * maximin disagree, so it passed with the weakest-member weight set to zero.
   *
   * This builds the disagreement on purpose. Holding price and distance equal,
   * compatibility is 0.31 + 0.6 × cuisineScore: an exact match scores 0.91, a
   * same-family match 0.82, and no match 0.52. `deli` shares a family with both
   * `american` and `cafe`, which is what makes the conflict constructible:
   *
   *   cafe  → [0.52, 0.91, 0.91, 0.91, 0.91]   mean 0.832, worst 0.52
   *   deli  → [0.82, 0.82, 0.82, 0.82, 0.82]   mean 0.820, worst 0.82
   *
   * The higher mean belongs to the option that fails one person. A rule that
   * maximised the average would take `cafe`; Viand should take `deli`. That is
   * the entire product claim, reduced to a single assertion.
   *
   * KNOWN VIOLATION — this is `it.fails`, so the suite stays green while the
   * defect stays visible, and the day it is fixed this test fails until the
   * marker is removed.
   *
   * Viand currently picks `cafe`. Cuisine is counted twice: once inside each
   * member's compatibility, where it is 60% of the value and a same-family
   * match earns 0.85, and again as a group-level `cuisineMatch` term worth 0.15
   * that credits exact matches only. `deli` therefore scores 0.0 on that term
   * despite suiting all five members, which hands `cafe` +0.120 against the
   * +0.105 the weakest-member weight gives `deli`. The fairness term is
   * outvoted by a double count of something it has already accounted for.
   */
  it.fails("takes the option nobody hates over the option with the better average", () => {
    const constant = { distanceMiles: 1, priceLevel: 2 as PriceLevel, rating: 4 };
    const cafe = restaurant({ id: "cafe", cuisine: "cafe", ...constant });
    const deli = restaurant({ id: "deli", cuisine: "deli", ...constant });

    const group = [
      preference({ preferredCuisines: ["american"] }),
      ...Array.from({ length: 4 }, () => preference({ preferredCuisines: ["cafe"] })),
    ];
    const soft = group.map(softPreferencesOf);

    const profile = (place: Restaurant) => {
      const values = soft.map((member) => memberCompatibility(place, member));
      return {
        worst: Math.min(...values),
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      };
    };

    // The premise: this really is a case where mean and worst-served disagree.
    expect(profile(cafe).mean).toBeGreaterThan(profile(deli).mean);
    expect(profile(deli).worst).toBeGreaterThan(profile(cafe).worst);

    const chosen = recommend([cafe, deli], group).candidates[0];
    expect(chosen?.restaurant.id).toBe("deli");
  });

  it("never lets an eliminated option reappear as a candidate", () => {
    const rng = new Rng(SEED + 3);
    for (let index = 0; index < CASES; index += 1) {
      const { restaurants, preferences } = scenario(rng);
      const result = recommend(restaurants, preferences);
      if (result.dietaryUnverified) continue; // documented, labelled fallback

      const hard = preferences.map(hardConstraintsOf);
      for (const candidate of result.candidates) {
        for (const constraints of hard) {
          expect(hardRestrictions(candidate.restaurant, constraints)).toEqual([]);
        }
      }
    }
  });

  /**
   * Monotonicity for one member: an option that fits somebody strictly better
   * must not score worse for them. A rule that violated this would punish
   * people for saying what they want.
   */
  it("never scores a better-fitting option lower for the member it fits", () => {
    const rng = new Rng(SEED + 4);
    for (let index = 0; index < CASES; index += 1) {
      const wanted = rng.pick([...CUISINES]) as Cuisine;
      const soft = softPreferencesOf(preference({ preferredCuisines: [wanted] }));
      const near = restaurant({ id: "a", cuisine: wanted, distanceMiles: 1 });
      const far = restaurant({ id: "b", cuisine: wanted, distanceMiles: 4 });

      expect(memberCompatibility(near, soft)).toBeGreaterThanOrEqual(memberCompatibility(far, soft));
    }
  });

  it("returns no more options than it promises, and never a duplicate", () => {
    const rng = new Rng(SEED + 5);
    for (let index = 0; index < CASES; index += 1) {
      const { restaurants, preferences } = scenario(rng);
      const ids = recommend(restaurants, preferences).candidates.map((c) => c.restaurant.id);

      expect(ids.length).toBeLessThanOrEqual(5);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
