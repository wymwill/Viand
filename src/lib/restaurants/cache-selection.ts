import type { Restaurant } from "@/domain/restaurants/provider";

/**
 * Chooses which listings a bounded cache should keep.
 *
 * The obvious implementation — keep the nearest N — collapses the result into
 * one city block. Listings arrive sorted by distance, and in a dense area the
 * nearest 25 are a handful of streets and often only three or four cuisines,
 * which leaves the scorer nothing to choose between and makes every group's
 * shortlist look the same.
 *
 * So the budget is spent round-robin across cuisines, nearest first within
 * each: one Thai, one Italian, one Korean, then a second of each, and so on.
 * Variety is what the group is actually choosing among, and because different
 * cuisines sit at different distances this also spreads the result across the
 * whole radius rather than clustering it at the centre.
 *
 * Distance order is preserved in the output, so a trimmed result is
 * indistinguishable from an untrimmed one apart from its size.
 */
export function selectForCache(restaurants: readonly Restaurant[], limit: number): Restaurant[] {
  if (limit <= 0 || restaurants.length <= limit) return [...restaurants];

  const byCuisine = new Map<string, Restaurant[]>();
  for (const restaurant of restaurants) {
    const bucket = byCuisine.get(restaurant.cuisine);
    if (bucket) bucket.push(restaurant);
    else byCuisine.set(restaurant.cuisine, [restaurant]);
  }

  // Cuisines in order of their nearest member, so a round that runs short still
  // favours what is closest rather than whichever key happened to be inserted.
  const queues = [...byCuisine.values()].sort(
    (a, b) => (a[0]?.distanceMiles ?? 0) - (b[0]?.distanceMiles ?? 0),
  );

  const kept = new Set<Restaurant>();
  let round = 0;
  while (kept.size < limit) {
    let tookAny = false;
    for (const queue of queues) {
      const candidate = queue[round];
      if (!candidate) continue;
      kept.add(candidate);
      tookAny = true;
      if (kept.size >= limit) break;
    }
    // Every cuisine is exhausted; nothing further to take.
    if (!tookAny) break;
    round += 1;
  }

  return restaurants.filter((restaurant) => kept.has(restaurant));
}
