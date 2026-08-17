import { describe, expect, it } from "vitest";
import { evaluateOpeningHours } from "@/lib/restaurants/opening-hours";

const UTC = "UTC";

function at(day: number, hour: number, minute = 0): Date {
  // 2024-01-01 is a Monday. Built as a UTC instant and read back in a named
  // zone, so these assertions do not depend on the machine running them.
  return new Date(Date.UTC(2024, 0, day, hour, minute));
}

describe("evaluateOpeningHours", () => {
  it("treats 24/7 as always open", () => {
    expect(evaluateOpeningHours("24/7", at(3, 4), UTC)).toBe("open");
  });

  it("evaluates weekday hours and defaults unlisted days to closed", () => {
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00", at(1, 12), UTC)).toBe("open");
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00", at(1, 18), UTC)).toBe("closed");
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00", at(6, 12), UTC)).toBe("closed");
  });

  it("handles overnight hours across midnight", () => {
    expect(evaluateOpeningHours("Mo 20:00-02:00", at(1, 23), UTC)).toBe("open");
    expect(evaluateOpeningHours("Mo 20:00-02:00", at(2, 1), UTC)).toBe("open");
    expect(evaluateOpeningHours("Mo 20:00-02:00", at(2, 3), UTC)).toBe("closed");
  });

  it("wraps Sunday overnight hours into Monday", () => {
    expect(evaluateOpeningHours("Su 20:00-02:00", at(8, 1), UTC)).toBe("open");
  });

  it("lets a later off rule override a broader rule", () => {
    expect(evaluateOpeningHours("Mo-Su 11:00-22:00; Tu off", at(2, 12), UTC)).toBe("closed");
    expect(evaluateOpeningHours("Mo-Su 11:00-22:00; Tu off", at(3, 12), UTC)).toBe("open");
  });

  it("supports comma-separated day lists and time ranges", () => {
    const hours = "Sa,Su 11:00-14:00,17:00-22:00";
    expect(evaluateOpeningHours(hours, at(6, 12), UTC)).toBe("open");
    expect(evaluateOpeningHours(hours, at(7, 18), UTC)).toBe("open");
    expect(evaluateOpeningHours(hours, at(7, 15), UTC)).toBe("closed");
  });

  /**
   * Split lunch and dinner service written as two rules for the same days.
   * This is the ordinary shape of a restaurant's hours, and treating the
   * second rule as a replacement silently dropped lunch.
   */
  it("combines separate rules covering the same day", () => {
    const hours = "Mo-Fr 11:00-14:00; Mo-Fr 17:00-22:00";
    expect(evaluateOpeningHours(hours, at(1, 12), UTC)).toBe("open");
    expect(evaluateOpeningHours(hours, at(1, 19), UTC)).toBe("open");
    expect(evaluateOpeningHours(hours, at(1, 15), UTC)).toBe("closed");
  });

  it("still lets an explicit closure win over an accumulated day", () => {
    const hours = "Mo 11:00-14:00; Mo 17:00-22:00; Mo off";
    expect(evaluateOpeningHours(hours, at(1, 12), UTC)).toBe("closed");
  });

  /**
   * The bug this pins is severe on a serverless host, where the process runs
   * in UTC: reading the host clock reports a Californian restaurant closed at
   * noon local. The zone is supplied, never inferred.
   */
  it("reads the clock in the restaurant's zone, not the host's", () => {
    // 19:00Z is 12:00 in Los Angeles and 20:00 in Berlin on this date.
    const instant = new Date(Date.UTC(2024, 0, 1, 19, 0));
    expect(evaluateOpeningHours("Mo-Fr 11:00-14:00", instant, "America/Los_Angeles")).toBe("open");
    expect(evaluateOpeningHours("Mo-Fr 11:00-14:00", instant, "Europe/Berlin")).toBe("closed");
  });

  it("reports hours unverified when the zone is unknown or invalid", () => {
    // Declining to answer beats eliminating an open restaurant on a wrong offset.
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00", at(1, 12), null)).toBe("unverified");
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00", at(1, 12), undefined)).toBe("unverified");
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00", at(1, 12), "Not/AZone")).toBe("unverified");
  });

  it("fails the whole expression safe for unsupported syntax", () => {
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00; PH off", at(1, 12), UTC)).toBe("unverified");
  });

  it("does not verify missing or empty hours", () => {
    expect(evaluateOpeningHours(undefined, at(1, 12), UTC)).toBe("unverified");
    expect(evaluateOpeningHours(null, at(1, 12), UTC)).toBe("unverified");
    expect(evaluateOpeningHours("  ", at(1, 12), UTC)).toBe("unverified");
  });
});
