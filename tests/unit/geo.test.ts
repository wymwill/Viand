import { describe, expect, it } from "vitest";
import { chainIdOf, distanceMiles, parseSharedLocation } from "@/lib/restaurants/geo";

const BERKELEY = { latitude: 37.8715, longitude: -122.273 };

describe("parseSharedLocation", () => {
  it("reads a bare coordinate pair", () => {
    expect(parseSharedLocation("37.8715, -122.2730")).toEqual({
      latitude: 37.8715,
      longitude: -122.273,
    });
  });

  it("reads coordinates out of a shared map link", () => {
    expect(parseSharedLocation("https://maps.apple.com/?ll=37.8715,-122.2730&q=Here")).toEqual({
      latitude: 37.8715,
      longitude: -122.273,
    });
    expect(parseSharedLocation("https://www.google.com/maps/@37.8715,-122.2730,15z")).toEqual({
      latitude: 37.8715,
      longitude: -122.273,
    });
  });

  it("rejects text that is not a location", () => {
    expect(parseSharedLocation("Downtown Berkeley")).toBeNull();
    expect(parseSharedLocation("94110")).toBeNull();
    expect(parseSharedLocation("999, 999")).toBeNull();
  });
});

describe("distanceMiles", () => {
  it("measures a short hop", () => {
    const near = distanceMiles(BERKELEY, { latitude: 37.872, longitude: -122.2735 });
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(0.1);
  });

  it("measures a known long distance", () => {
    // Berkeley to Los Angeles is roughly 340 miles.
    const far = distanceMiles(BERKELEY, { latitude: 34.0522, longitude: -118.2437 });
    expect(far).toBeGreaterThan(320);
    expect(far).toBeLessThan(360);
  });
});

describe("chainIdOf", () => {
  it("gives branches of one brand the same id", () => {
    expect(chainIdOf("Slice Society (Downtown)")).toBe(chainIdOf("slice society downtown"));
    expect(chainIdOf("Taqueria Uno")).not.toBe(chainIdOf("Pizza Pi"));
  });
});
