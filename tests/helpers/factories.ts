import { emptyPreference, type MemberPreference } from "@/domain/types";
import type { Restaurant } from "@/domain/restaurants/provider";

export function preference(overrides: Partial<MemberPreference> = {}): MemberPreference {
  return { ...emptyPreference(overrides.originalMessage ?? "test"), ...overrides };
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
    ...overrides,
  };
}
