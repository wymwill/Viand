import { describe, expect, it } from "vitest";
import { evaluateOpeningHours } from "@/lib/restaurants/opening-hours";

function local(day: number, hour: number, minute = 0): Date {
  // 2024-01-01 is a Monday; the evaluator intentionally uses local wall time.
  return new Date(2024, 0, day, hour, minute);
}

describe("evaluateOpeningHours", () => {
  it("treats 24/7 as always open", () => {
    expect(evaluateOpeningHours("24/7", local(3, 4))).toBe("open");
  });

  it("evaluates weekday hours and defaults unlisted days to closed", () => {
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00", local(1, 12))).toBe("open");
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00", local(1, 18))).toBe("closed");
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00", local(6, 12))).toBe("closed");
  });

  it("handles overnight hours across midnight", () => {
    expect(evaluateOpeningHours("Mo 20:00-02:00", local(1, 23))).toBe("open");
    expect(evaluateOpeningHours("Mo 20:00-02:00", local(2, 1))).toBe("open");
    expect(evaluateOpeningHours("Mo 20:00-02:00", local(2, 3))).toBe("closed");
  });

  it("wraps Sunday overnight hours into Monday", () => {
    expect(evaluateOpeningHours("Su 20:00-02:00", local(8, 1))).toBe("open");
  });

  it("lets a later off rule override a broader rule", () => {
    expect(evaluateOpeningHours("Mo-Su 11:00-22:00; Tu off", local(2, 12))).toBe("closed");
    expect(evaluateOpeningHours("Mo-Su 11:00-22:00; Tu off", local(3, 12))).toBe("open");
  });

  it("supports comma-separated day lists and time ranges", () => {
    const hours = "Sa,Su 11:00-14:00,17:00-22:00";
    expect(evaluateOpeningHours(hours, local(6, 12))).toBe("open");
    expect(evaluateOpeningHours(hours, local(7, 18))).toBe("open");
    expect(evaluateOpeningHours(hours, local(7, 15))).toBe("closed");
  });

  it("fails the whole expression safe for unsupported syntax", () => {
    expect(evaluateOpeningHours("Mo-Fr 09:00-17:00; PH off", local(1, 12))).toBe("unverified");
  });

  it("does not verify missing or empty hours", () => {
    expect(evaluateOpeningHours(undefined, local(1, 12))).toBe("unverified");
    expect(evaluateOpeningHours(null, local(1, 12))).toBe("unverified");
    expect(evaluateOpeningHours("  ", local(1, 12))).toBe("unverified");
  });
});
