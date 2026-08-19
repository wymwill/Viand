/**
 * Proves a demo will work, by doing the demo.
 *
 * Warming the cache only shows that a search returned rows. What matters on
 * stage is the whole decision: a location, several people wanting different
 * things, a shortlist, a vote, and a winner. This drives the real state machine
 * over the real cached listings and fails loudly if any step comes back empty,
 * so a broken demo is discovered here rather than in front of an audience.
 *
 * Run it inside the hour you intend to demo — cache freshness is bucketed by
 * the hour.
 *
 *   npm run demo:verify -- "Boston, MA" "Los Angeles, CA"
 */
import { parseCommand } from "@/domain/commands";
import { deterministicInterpretation } from "@/domain/interpret/deterministic";
import { advance } from "@/domain/state-machine/engine";
import { initialSnapshot, type SessionSnapshot } from "@/domain/state-machine/session";
import * as copy from "@/domain/messages/copy";
import { tally } from "@/domain/voting/tally";
import { getRestaurantProvider } from "@/lib/restaurants";
import type { RestaurantProvider } from "@/domain/restaurants/provider";

const GROUP = [
  ["alice", "I'm vegetarian"],
  ["bob", "under $25"],
  ["carol", "somewhere close, nothing too far"],
] as const;

async function say(
  snapshot: SessionSnapshot,
  restaurants: RestaurantProvider,
  memberId: string,
  text: string,
) {
  const interpretation = deterministicInterpretation({
    text,
    command: parseCommand(text),
    state: snapshot.state,
  });
  return advance({ snapshot, memberId, interpretation, restaurants, now: new Date() });
}

async function runDecision(place: string, restaurants: RestaurantProvider): Promise<boolean> {
  const started = Date.now();
  let snapshot = initialSnapshot(true);
  let replies: { text: string }[] = [];

  ({ snapshot } = await say(snapshot, restaurants, "alice", place));
  if (snapshot.state !== "COLLECTING_PREFERENCES") {
    console.error(`  location "${place}" not accepted — state is ${snapshot.state}`);
    return false;
  }

  for (const [member, text] of GROUP) {
    ({ snapshot } = await say(snapshot, restaurants, member, text));
  }

  ({ snapshot, replies } = await say(snapshot, restaurants, "alice", "done"));

  const said = replies.map((reply) => reply.text).join("\n");
  if (said.includes(copy.SEARCH_UNAVAILABLE)) {
    console.error("  the restaurant source could not be reached");
    return false;
  }
  if (said.includes(copy.NO_OPTIONS_FOUND) || snapshot.candidates.length === 0) {
    console.error("  no option satisfied the group — nothing to show");
    return false;
  }

  console.log(`  ${snapshot.candidates.length} options in ${Date.now() - started}ms`);
  snapshot.candidates.forEach((candidate, index) => {
    const { name, cuisine, distanceMiles } = candidate.restaurant;
    console.log(`   ${index + 1}. ${name} — ${cuisine}, ${distanceMiles.toFixed(1)} mi`);
  });
  if (said.includes(copy.DIETARY_UNVERIFIED)) {
    console.log("   (dietary fit could not be confirmed here; the group is told so)");
  }

  // A shortlist nobody can vote on is not a decision.
  ({ snapshot } = await say(snapshot, restaurants, "alice", "1"));
  ({ snapshot } = await say(snapshot, restaurants, "bob", "1"));
  ({ snapshot, replies } = await say(snapshot, restaurants, "carol", "done"));

  const winner = tally(snapshot.candidates, snapshot.ballots).winner;
  if (!winner) {
    console.error("  votes did not resolve to a winner");
    return false;
  }

  console.log(`  winner: ${winner.candidate.restaurant.name}`);
  return true;
}

async function main(): Promise<void> {
  const places = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (places.length === 0) {
    console.error('Usage: npm run demo:verify -- "Boston, MA" "Los Angeles, CA"');
    process.exit(1);
  }

  const live = process.env.USE_MOCK_RESTAURANTS === "false";
  const shared = Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
  console.log(
    `source: ${live ? "live OpenStreetMap" : "mock catalogue"} | ` +
      `cache: ${shared ? "shared (Redis)" : "process-local"}\n`,
  );
  if (live && !shared) {
    console.warn("Warning: without Redis this warms a cache the deployed app cannot read.\n");
  }

  const restaurants = getRestaurantProvider();
  let failed = 0;

  for (const place of places) {
    console.log(`${place}`);
    try {
      // Twice: the first fills the shared cache, the second proves a demo-time
      // search is a cache hit rather than another gamble on a public mirror.
      if (!(await runDecision(place, restaurants))) failed += 1;
      const warmStarted = Date.now();
      await runDecision(place, restaurants);
      console.log(`  repeat run (cached): ${Date.now() - warmStarted}ms`);
    } catch (error) {
      failed += 1;
      console.error(`  FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log("");
  }

  if (failed > 0) {
    console.error(`${failed} of ${places.length} location(s) cannot currently be demoed.`);
    process.exit(1);
  }
  console.log(`All ${places.length} location(s) verified and cached.`);
}

void main();
