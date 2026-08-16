import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOCK_RESTAURANTS } from "@/domain/restaurants/mock-data";
import { recommend } from "@/domain/recommendations/select";
import type { MemberPreference } from "@/domain/types";
import { preference } from "../helpers/factories";

/**
 * Behaviour lock for the recommendation path.
 *
 * This exists to make the hard/soft constraint split (Phase 2.1) provable as a
 * pure refactor. It pins the full observable output of `recommend()` — the
 * chosen ids in order, every score component, the explanations, and the
 * elimination count — across a spread of preference shapes. It was generated
 * before the split and must pass byte-identical after it. A diff here is a
 * regression, never an improvement.
 *
 * Regenerate deliberately, and only when a behaviour change is intended:
 *
 *   VIAND_WRITE_CHARACTERIZATION=1 npx vitest run recommend-characterization
 */

const FIXTURE = fileURLToPath(
  new URL("../fixtures/recommend-characterization.json", import.meta.url),
);

/** Enough digits that any real arithmetic change shows, without float noise. */
function round(value: number): number {
  return Number(value.toFixed(12));
}

interface Scenario {
  name: string;
  preferences: MemberPreference[];
  vetoedRestaurantIds?: string[];
  limit?: number;
}

/**
 * Chosen to exercise every branch the split touches: the no-preference flat
 * value, the cuisine family partial credit, each hard restriction kind on its
 * own, the dual-use price and distance fields in both their filtering and
 * their comfort-curve roles, and the empty-preferences fallback.
 */
const SCENARIOS: Scenario[] = [
  {
    name: "no preferences at all",
    preferences: [],
  },
  {
    name: "single default member",
    preferences: [preference()],
  },
  {
    name: "single easygoing member",
    preferences: [preference({ noPreference: true })],
  },
  {
    name: "exact cuisine preference",
    preferences: [preference({ preferredCuisines: ["mexican"] })],
  },
  {
    name: "cuisine family partial credit",
    preferences: [preference({ preferredCuisines: ["japanese"] })],
  },
  {
    name: "excluded cuisine",
    preferences: [preference({ excludedCuisines: ["mexican", "pizza"] })],
  },
  {
    name: "dietary requirement",
    preferences: [preference({ dietary: ["vegan"] })],
  },
  {
    name: "price ceiling only",
    preferences: [preference({ maxPriceLevel: 2 })],
  },
  {
    name: "distance limit only",
    preferences: [preference({ maxDistanceMiles: 1.2 })],
  },
  {
    name: "mixed group of four",
    preferences: [
      preference({ preferredCuisines: ["mexican"], maxPriceLevel: 2 }),
      preference({ dietary: ["vegetarian"], maxDistanceMiles: 2 }),
      preference({ noPreference: true }),
      preference({ preferredCuisines: ["ramen", "korean"], excludedCuisines: ["seafood"] }),
    ],
  },
  {
    name: "group with an allergy concern",
    preferences: [
      preference({ dietary: ["gluten_free"], hasAllergyConcern: true }),
      preference({ preferredCuisines: ["american"] }),
    ],
  },
  {
    name: "veto applied",
    preferences: [preference({ preferredCuisines: ["mexican"] })],
    vetoedRestaurantIds: ["tacoria"],
  },
  {
    name: "explicit limit of three",
    preferences: [preference()],
    limit: 3,
  },
  {
    name: "restrictions eliminate everything",
    preferences: [
      preference({ dietary: ["vegan"], maxPriceLevel: 1, maxDistanceMiles: 0.1 }),
    ],
  },
];

function capture(scenario: Scenario) {
  const options: { vetoedRestaurantIds?: string[]; limit?: number } = {};
  if (scenario.vetoedRestaurantIds) options.vetoedRestaurantIds = scenario.vetoedRestaurantIds;
  if (scenario.limit != null) options.limit = scenario.limit;

  const result = recommend(MOCK_RESTAURANTS, scenario.preferences, options);

  return {
    name: scenario.name,
    eliminatedCount: result.eliminatedCount,
    needsAllergyDisclaimer: result.needsAllergyDisclaimer,
    candidates: result.candidates.map((candidate) => ({
      id: candidate.restaurant.id,
      explanation: candidate.explanation,
      score: {
        total: round(candidate.score.total),
        weakestMember: round(candidate.score.weakestMember),
        averageMember: round(candidate.score.averageMember),
        cuisineMatch: round(candidate.score.cuisineMatch),
        distance: round(candidate.score.distance),
        rating: round(candidate.score.rating),
        priceMatch: round(candidate.score.priceMatch),
      },
    })),
  };
}

describe("recommendation characterization", () => {
  const actual = SCENARIOS.map(capture);

  if (process.env.VIAND_WRITE_CHARACTERIZATION === "1") {
    writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
  }

  const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof actual;

  it("covers every pinned scenario", () => {
    expect(actual.map((entry) => entry.name)).toEqual(expected.map((entry) => entry.name));
  });

  for (const [index, scenario] of SCENARIOS.entries()) {
    it(`reproduces: ${scenario.name}`, () => {
      expect(actual[index]).toEqual(expected[index]);
    });
  }
});
