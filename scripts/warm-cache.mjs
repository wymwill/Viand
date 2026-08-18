#!/usr/bin/env node
/**
 * Pre-fetches searches into the shared cache before a demo or a busy period.
 *
 * The public Overpass mirrors refuse heavy requests often enough that a cold
 * search is the most likely way a live demo fails. Warming writes the results
 * to Redis, which every serverless instance reads, so the first real search is
 * a cache hit rather than a gamble.
 *
 * Freshness is bucketed by the hour, so warm within the hour you intend to
 * demo. An older entry still survives as the stale-on-failure fallback.
 *
 *   npm run cache:warm -- "Boston, MA" "Los Angeles, CA"
 */

const places = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

if (places.length === 0) {
  console.error('Usage: npm run cache:warm -- "Boston, MA" "Los Angeles, CA"');
  process.exit(1);
}

if (process.env.USE_MOCK_RESTAURANTS !== "false") {
  console.error("Set USE_MOCK_RESTAURANTS=false; there is nothing to warm on the mock catalogue.");
  process.exit(1);
}

const shared = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
if (!shared) {
  console.warn("No Upstash configuration found — warming a process-local cache, which the");
  console.warn("deployed app cannot read. Set UPSTASH_REDIS_REST_URL and _TOKEN to warm production.");
}

const { getRestaurantProvider } = await import("../src/lib/restaurants/index.ts");
const provider = getRestaurantProvider();
const radius = Number(process.env.WARM_RADIUS_MILES ?? 5);

let failures = 0;
for (const place of places) {
  const started = Date.now();
  try {
    const result = await provider.search({
      locationText: place,
      radiusMiles: radius,
      now: new Date(),
    });
    const degraded = result.sourceLabel.includes("could not be reached");
    console.log(
      `${place}: ${result.restaurants.length} results in ${Date.now() - started}ms` +
        `${degraded ? " (full radius not reached)" : ""}`,
    );
  } catch (error) {
    failures += 1;
    console.error(`${place}: FAILED — ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} of ${places.length} failed. Re-run; the mirrors are intermittent.`);
  process.exit(1);
}

console.log(`\nWarmed ${places.length} location(s) into the ${shared ? "shared" : "local"} cache.`);
