import { emptyPreference, type MemberPreference } from "@/domain/types";
import {
  hardConstraintsOf,
  softPreferencesOf,
  type HardConstraints,
  type SoftPreferences,
} from "@/domain/recommendations/constraints";
import type { Restaurant } from "@/domain/restaurants/provider";

export function preference(overrides: Partial<MemberPreference> = {}): MemberPreference {
  return { ...emptyPreference(overrides.originalMessage ?? "test"), ...overrides };
}

/**
 * The two projections, built from the same flat override shape the rest of the
 * suite already uses. Tests keep saying `{ maxPriceLevel: 2 }` and the helper
 * decides which half of the record that lands in, so a test reads as the
 * intent ("this member's budget is a hard ceiling") rather than as plumbing.
 */
export function hard(overrides: Partial<MemberPreference> = {}): HardConstraints {
  return hardConstraintsOf(preference(overrides));
}

export function soft(overrides: Partial<MemberPreference> = {}): SoftPreferences {
  return softPreferencesOf(preference(overrides));
}

export function restaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: "r1",
    name: "Test Kitchen",
    chainId: null,
    address: "1 Test St",
    cuisine: "american",
    priceLevel: 2,
    rating: 4.0,
    distanceMiles: 1.0,
    mapsUrl: "https://maps.google.com/?q=test",
    accommodates: [],
    openNow: true,
    openingHoursRaw: null,
    ...overrides,
  };
}
