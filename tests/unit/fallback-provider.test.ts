import { describe, expect, it } from "vitest";
import type {
  RestaurantProvider,
  RestaurantSearchResult,
} from "@/domain/restaurants/provider";
import { restaurant } from "../helpers/factories";
import { FallbackRestaurantProvider } from "@/lib/restaurants/fallback-provider";

function result(count: number, label: string): RestaurantSearchResult {
  return {
    restaurants: Array.from({ length: count }, (_, index) =>
      restaurant({ id: `${label}-${index}` }),
    ),
    source: "osm",
    sourceLabel: label,
    resolvedLocation: null,
  };
}

function ok(count: number, label: string): RestaurantProvider {
  return { search: async () => result(count, label) };
}

function broken(message = "unavailable"): RestaurantProvider {
  return {
    search: async () => {
      throw new Error(message);
    },
  };
}

const input = { locationText: "Berkeley", radiusMiles: 5, now: new Date("2024-01-01T12:00:00Z") };
const silent = () => {};

describe("FallbackRestaurantProvider", () => {
  it("uses the primary source when it returns results", async () => {
    const provider = new FallbackRestaurantProvider(ok(3, "primary"), ok(3, "fallback"), silent);
    await expect(provider.search(input)).resolves.toMatchObject({ sourceLabel: "primary" });
  });

  it("falls back when the primary throws", async () => {
    const errors: unknown[] = [];
    const provider = new FallbackRestaurantProvider(broken(), ok(2, "fallback"), (e) =>
      errors.push(e),
    );

    await expect(provider.search(input)).resolves.toMatchObject({ sourceLabel: "fallback" });
    expect(errors).toHaveLength(1);
  });

  it("falls back when the primary succeeds but has no listings", async () => {
    const provider = new FallbackRestaurantProvider(ok(0, "primary"), ok(2, "fallback"), silent);
    await expect(provider.search(input)).resolves.toMatchObject({ sourceLabel: "fallback" });
  });

  it("keeps the primary's empty answer when the fallback is also empty", async () => {
    // Both sources agree there is nothing here, which is a real answer.
    const provider = new FallbackRestaurantProvider(ok(0, "primary"), ok(0, "fallback"), silent);
    await expect(provider.search(input)).resolves.toMatchObject({ sourceLabel: "primary" });
  });

  it("keeps the primary's empty answer when the fallback fails", async () => {
    const provider = new FallbackRestaurantProvider(ok(0, "primary"), broken(), silent);
    await expect(provider.search(input)).resolves.toMatchObject({ sourceLabel: "primary" });
  });

  it("propagates when both sources fail, so the group gets a retry message", async () => {
    const provider = new FallbackRestaurantProvider(broken("a"), broken("b"), silent);
    await expect(provider.search(input)).rejects.toThrow("b");
  });
});
