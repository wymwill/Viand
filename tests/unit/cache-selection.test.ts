import { describe, expect, it } from "vitest";
import type { Cuisine } from "@/domain/types";
import { selectForCache } from "@/lib/restaurants/cache-selection";
import { restaurant } from "../helpers/factories";

const CUISINES: Cuisine[] = ["mexican", "thai", "italian", "korean", "japanese", "indian"];

/**
 * Mirrors real data: sorted by distance, and the closest cluster is dominated
 * by one or two cuisines while the variety sits further out.
 */
function catalogue() {
  return Array.from({ length: 80 }, (_, index) =>
    restaurant({
      id: `r-${index}`,
      distanceMiles: Number((index * 0.06).toFixed(2)),
      cuisine: index < 30 ? "pizza" : (CUISINES[index % CUISINES.length] as Cuisine),
    }),
  );
}

describe("choosing what a bounded cache keeps", () => {
  it("keeps a spread of cuisines rather than one nearby cluster", () => {
    const kept = selectForCache(catalogue(), 25);
    const naive = catalogue().slice(0, 25);

    const variety = (list: ReturnType<typeof catalogue>) =>
      new Set(list.map((r) => r.cuisine)).size;

    // The nearest 25 are all pizza; the group would be choosing between
    // identical options.
    expect(variety(naive)).toBe(1);
    expect(variety(kept)).toBeGreaterThan(4);
    expect(kept).toHaveLength(25);
  });

  it("reaches across the whole radius instead of clustering at the centre", () => {
    const kept = selectForCache(catalogue(), 25);
    const farthest = Math.max(...kept.map((r) => r.distanceMiles));
    const naiveFarthest = Math.max(...catalogue().slice(0, 25).map((r) => r.distanceMiles));

    expect(farthest).toBeGreaterThan(naiveFarthest * 2);
  });

  it("still favours the closest of each cuisine", () => {
    const kept = selectForCache(catalogue(), 25);
    const pizza = kept.filter((r) => r.cuisine === "pizza");

    expect(pizza[0]?.id).toBe("r-0");
    // Distance order survives the trim.
    const distances = kept.map((r) => r.distanceMiles);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("leaves a result alone when it already fits", () => {
    expect(selectForCache(catalogue().slice(0, 10), 25)).toHaveLength(10);
  });
});
