import { describe, expect, it } from "vitest";
import {
  buildCorpus,
  corpusDigest,
  DEFAULT_CATALOGUE_SIZE,
  DEFAULT_GROUP_COUNT,
  DEFAULT_SEED,
} from "../../scripts/eval/index";
import { evaluateChoice, satisfaction, summarise } from "../../scripts/eval/satisfaction";
import { averageStrategy } from "../../scripts/eval/strategies/average";
import { deterministicStrategy } from "../../scripts/eval/strategies/deterministic";
import { hardConstraintsOf } from "@/domain/recommendations/constraints";
import { hardRestrictions } from "@/domain/recommendations/scoring";

const CORPUS_OPTIONS = {
  seed: DEFAULT_SEED,
  groupCount: DEFAULT_GROUP_COUNT,
  catalogue: "synthetic" as const,
  catalogueSize: DEFAULT_CATALOGUE_SIZE,
};

/**
 * Pinned digest of the default corpus. An eval result is only comparable to a
 * previous one if the benchmark itself did not move, so a change in the order
 * or number of random draws has to be a visible, deliberate act rather than an
 * incidental side effect of editing the generator.
 *
 * If this fails after an intentional generator change, update it in the same
 * commit and treat previously recorded eval numbers as void.
 */
const PINNED_DIGEST = "2d9f8000";

describe("eval corpus", () => {
  const corpus = buildCorpus(CORPUS_OPTIONS);

  it("is reproducible from the seed", () => {
    expect(corpusDigest(corpus)).toBe(PINNED_DIGEST);
    expect(corpusDigest(buildCorpus(CORPUS_OPTIONS))).toBe(PINNED_DIGEST);
  });

  it("produces a different corpus for a different seed", () => {
    const other = buildCorpus({ ...CORPUS_OPTIONS, seed: DEFAULT_SEED + 1 });
    expect(corpusDigest(other)).not.toBe(PINNED_DIGEST);
  });

  it("generates 50 groups of 2 to 6 members", () => {
    expect(corpus.groups).toHaveLength(50);
    for (const group of corpus.groups) {
      expect(group.members.length).toBeGreaterThanOrEqual(2);
      expect(group.members.length).toBeLessThanOrEqual(6);
    }
  });

  it("gives every member a preference vector and some a hard constraint", () => {
    const members = corpus.groups.flatMap((group) => group.members);

    for (const member of members) {
      const utilities = Object.values(member.latent.cuisineUtility);
      expect(utilities.length).toBeGreaterThan(0);
      for (const utility of utilities) {
        expect(utility).toBeGreaterThanOrEqual(0);
        expect(utility).toBeLessThanOrEqual(1);
      }
      expect(member.sentence.length).toBeGreaterThan(0);
      expect(member.stated.originalMessage).toBe(member.sentence);
    }

    const constrained = members.filter((member) => member.latent.hardConstraint != null);
    expect(constrained.length).toBeGreaterThan(0);
    expect(constrained.length).toBeLessThan(members.length);
  });

  it("keeps the stated preference a lossy view of the latent vector", () => {
    // The whole eval rests on strategies not being handed the answer key.
    const members = corpus.groups.flatMap((group) => group.members);
    const opinionated = members.filter((member) => !member.latent.easygoing);

    const someoneUndersold = opinionated.some((member) => {
      const stated = new Set<string>(member.stated.preferredCuisines);
      return Object.entries(member.latent.cuisineUtility).some(
        ([cuisine, utility]) => utility > 0.5 && !stated.has(cuisine),
      );
    });
    expect(someoneUndersold).toBe(true);
  });
});

describe("satisfaction metric", () => {
  const corpus = buildCorpus(CORPUS_OPTIONS);

  it("scores zero for a violated hard constraint, whatever else fits", () => {
    const member = corpus.groups
      .flatMap((group) => group.members)
      .find((entry) => entry.latent.hardConstraint?.kind === "excluded_cuisine");
    expect(member).toBeDefined();

    const constraint = member!.latent.hardConstraint;
    if (constraint?.kind !== "excluded_cuisine") throw new Error("unexpected constraint");

    const offending = {
      ...corpus.catalogue[0]!,
      cuisine: constraint.cuisine,
      priceLevel: 1 as const,
      distanceMiles: 0.1,
    };
    expect(satisfaction(member!, offending)).toBe(0);
  });

  it("stays within 0 and 1 across the whole corpus", () => {
    for (const group of corpus.groups) {
      for (const member of group.members) {
        for (const restaurant of corpus.catalogue) {
          const value = satisfaction(member, restaurant);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("records an abstention distinctly from a bad pick", () => {
    const group = corpus.groups[0]!;
    const abstained = evaluateChoice(group, null);
    expect(abstained.restaurantId).toBeNull();

    const summary = summarise("test", [abstained]);
    expect(summary.abstained).toBe(1);
    expect(summary.answered).toBe(0);
  });
});

describe("strategies", () => {
  const corpus = buildCorpus(CORPUS_OPTIONS);

  it("the deterministic scorer never breaks a stated hard constraint", () => {
    // This is the Phase 2.1 property, measured rather than asserted: because
    // hard constraints are eliminated before ranking and cannot reach a
    // scorer, no amount of soft-preference pressure can outweigh one.
    for (const group of corpus.groups) {
      const chosen = deterministicStrategy(group, corpus.catalogue);
      if (chosen == null) continue;
      for (const member of group.members) {
        expect(hardRestrictions(chosen, hardConstraintsOf(member.stated))).toEqual([]);
      }
    }
  });

  it("naive averaging does break them, which is why it is the baseline", () => {
    const violations = corpus.groups.reduce((sum, group) => {
      const chosen = averageStrategy(group, corpus.catalogue);
      return sum + (chosen == null ? 0 : evaluateChoice(group, chosen).violatedMemberIds.length);
    }, 0);
    expect(violations).toBeGreaterThan(0);
  });

  it("both strategies are deterministic across repeated runs", () => {
    for (const group of corpus.groups.slice(0, 10)) {
      expect(averageStrategy(group, corpus.catalogue)?.id).toBe(
        averageStrategy(group, corpus.catalogue)?.id,
      );
      expect(deterministicStrategy(group, corpus.catalogue)?.id).toBe(
        deterministicStrategy(group, corpus.catalogue)?.id,
      );
    }
  });
});
