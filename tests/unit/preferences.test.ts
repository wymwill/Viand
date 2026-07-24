import { describe, expect, it } from "vitest";
import { MINUTES_PER_MILE, parsePreference } from "@/domain/preferences/rules-parser";

describe("parsePreference", () => {
  it("preserves the original message verbatim", () => {
    const raw = "Mexican or Korean, under $25";
    expect(parsePreference(raw).originalMessage).toBe(raw);
  });

  it("extracts multiple preferred cuisines and a price ceiling", () => {
    const result = parsePreference("Mexican or Korean, under $25");
    expect(result.preferredCuisines).toEqual(expect.arrayContaining(["mexican", "korean"]));
    expect(result.excludedCuisines).toEqual([]);
    expect(result.maxPriceLevel).toBe(2);
  });

  it("extracts dietary needs and a travel-time limit", () => {
    const result = parsePreference("Vegetarian, within 15 minutes");
    expect(result.dietary).toContain("vegetarian");
    expect(result.maxDistanceMiles).toBeCloseTo(15 / MINUTES_PER_MILE);
  });

  it("treats 'anything except X' as no-preference plus an exclusion", () => {
    const result = parsePreference("Anything except seafood");
    expect(result.excludedCuisines).toContain("seafood");
    expect(result.preferredCuisines).toEqual([]);
    expect(result.noPreference).toBe(true);
  });

  it("scopes negation to its own clause", () => {
    const result = parsePreference("No seafood, but Mexican is great");
    expect(result.excludedCuisines).toContain("seafood");
    expect(result.preferredCuisines).toContain("mexican");
  });

  it("handles negation mid-clause", () => {
    const result = parsePreference("I want mexican not sushi");
    expect(result.preferredCuisines).toContain("mexican");
    expect(result.excludedCuisines).toContain("japanese");
    expect(result.preferredCuisines).not.toContain("japanese");
  });

  it("prefers the longest cuisine phrase", () => {
    const result = parsePreference("korean bbq please");
    expect(result.preferredCuisines).toEqual(["korean"]);
  });

  it("does not match cuisine words inside longer words", () => {
    // "no" must not match inside "noodles".
    const result = parsePreference("noodles");
    expect(result.preferredCuisines).toEqual(["ramen"]);
    expect(result.excludedCuisines).toEqual([]);
  });

  it("flags allergies and normalizes them to a dietary requirement", () => {
    const result = parsePreference("allergic to shellfish");
    expect(result.dietary).toContain("shellfish_free");
    expect(result.hasAllergyConcern).toBe(true);
  });

  it("does not flag an allergy for an ordinary cuisine preference", () => {
    expect(parsePreference("thai food").hasAllergyConcern).toBe(false);
  });

  it("recognizes explicit no-preference wording", () => {
    expect(parsePreference("whatever, I don't care").noPreference).toBe(true);
    expect(parsePreference("surprise me").noPreference).toBe(true);
  });

  it("does not claim no-preference when a cuisine was named", () => {
    expect(parsePreference("anything italian").noPreference).toBe(false);
  });

  it("reads bare dollar signs as a ceiling but not dollar amounts", () => {
    expect(parsePreference("$$ or cheaper").maxPriceLevel).toBe(2);
    expect(parsePreference("cheap eats").maxPriceLevel).toBe(1);
  });

  it("does not read a travel time as a price", () => {
    const result = parsePreference("within 20 minutes");
    expect(result.maxPriceLevel).toBeNull();
    expect(result.maxDistanceMiles).toBeCloseTo(20 / MINUTES_PER_MILE);
  });

  it("reads distance in miles directly", () => {
    expect(parsePreference("under 2 miles").maxDistanceMiles).toBe(2);
    expect(parsePreference("walking distance").maxDistanceMiles).toBe(0.5);
  });

  it("takes the most restrictive value when several are given", () => {
    const result = parsePreference("under $40, actually under $15");
    expect(result.maxPriceLevel).toBe(1);
  });

  it("returns an empty preference for unparseable text", () => {
    const result = parsePreference("hmmmm");
    expect(result.preferredCuisines).toEqual([]);
    expect(result.excludedCuisines).toEqual([]);
    expect(result.dietary).toEqual([]);
    expect(result.noPreference).toBe(false);
  });
});
