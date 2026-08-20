import { describe, expect, it } from "vitest";
import { dropDuplicates, type Locatable } from "@/lib/restaurants/duplicates";
import { restaurant } from "../helpers/factories";

/** ~0.00001 degrees of latitude is about a metre. */
const BASE = { latitude: 34.0537, longitude: -118.2428 };
const metresNorth = (metres: number) => ({
  latitude: BASE.latitude + metres * 0.000009,
  longitude: BASE.longitude,
});

function at(name: string, metres: number, overrides = {}): Locatable {
  return {
    restaurant: restaurant({ id: `${name}-${metres}`, name, ...overrides }),
    position: metresNorth(metres),
  };
}

describe("collapsing the same restaurant entered twice", () => {
  /**
   * The case from downtown Los Angeles: one business, two OSM nodes six metres
   * apart at the same address, reaching a group as two of its five options.
   */
  it("collapses a spelling variant at the same spot", () => {
    const kept = dropDuplicates([at("Korea BBQ House", 0), at("Korean BBQ House", 6)]);

    expect(kept).toHaveLength(1);
  });

  it("keeps whichever entry says more about the place", () => {
    const kept = dropDuplicates([
      at("Korea BBQ House", 0),
      at("Korean BBQ House", 6, {
        address: "123 Onizuka St",
        phone: "+1",
        openingHoursRaw: "Mo-Su 11:00-22:00",
      }),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.openingHoursRaw).toBe("Mo-Su 11:00-22:00");
  });

  it("treats a bare name and a longer form of it as one place", () => {
    expect(dropDuplicates([at("Viand", 0), at("Viand Cafe", 5)])).toHaveLength(1);
  });

  /**
   * The failure mode to avoid. A food hall or a busy block genuinely holds
   * several restaurants within a few metres, so proximity alone must never be
   * enough to merge them.
   */
  it("keeps different restaurants that happen to be neighbours", () => {
    const kept = dropDuplicates([at("Korea BBQ House", 0), at("Sushi Gen", 4), at("Daikokuya", 8)]);

    expect(kept).toHaveLength(3);
  });

  it("keeps two branches of one restaurant that are genuinely apart", () => {
    // Same name, half a kilometre away: a second location, not a duplicate.
    expect(dropDuplicates([at("bb.q Chicken", 0), at("bb.q Chicken", 500)])).toHaveLength(2);
  });

  it("does not merge on similar names alone when they are far apart", () => {
    expect(dropDuplicates([at("Korea BBQ House", 0), at("Korean BBQ House", 900)])).toHaveLength(2);
  });

  it("leaves a list with nothing to collapse untouched", () => {
    const entries = [at("A", 0), at("B", 100), at("C", 200)];
    expect(dropDuplicates(entries)).toHaveLength(3);
  });
});
