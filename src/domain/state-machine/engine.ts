import type { Interpretation } from "../interpret/types";
import * as copy from "../messages/copy";
import {
  isSplitOnCuisine,
  statedCuisines,
  type CuisineMediator,
} from "../recommendations/mediation";
import { recommend } from "../recommendations/select";
import type { Cuisine } from "../types";
import type { RestaurantProvider } from "../restaurants/provider";
import { tally } from "../voting/tally";
import { transition } from "./reducer";
import type { OutboundIntent, SessionSnapshot } from "./session";

export interface AdvanceInput {
  snapshot: SessionSnapshot;
  memberId: string;
  /** Command and preference already resolved by the interpretation layer. */
  interpretation: Interpretation;
  restaurants: RestaurantProvider;
  /** Wall clock supplied by the adapter boundary; domain code never constructs it. */
  now: Date;
  /**
   * Proposes a compromise cuisine when the group is split. Optional: without
   * it, a split group sees exactly what it saw before.
   */
  cuisineMediator?: CuisineMediator;
  /**
   * Reports a degradation the group was shielded from. The domain decides that
   * something went wrong and what to say about it; recording that fact is I/O,
   * so it belongs to the caller. Default is a no-op, which keeps `advance`
   * usable from a test without wiring anything.
   */
  onDegradation?: (event: string, cause: unknown) => void;
}

export interface AdvanceOutput {
  snapshot: SessionSnapshot;
  replies: OutboundIntent[];
}

function preferenceList(snapshot: SessionSnapshot) {
  return snapshot.activeMemberIds
    .map((memberId) => snapshot.preferences[memberId])
    .filter((preference): preference is NonNullable<typeof preference> => preference != null);
}

function vetoedRestaurantIds(snapshot: SessionSnapshot): string[] {
  return snapshot.ballots.filter((ballot) => ballot.veto).map((ballot) => ballot.candidateId);
}

/**
 * Drives one inbound message end to end: parse -> transition -> resolve any
 * effects the reducer emitted. Effects are where I/O lives (restaurant search),
 * so they run here rather than inside the pure reducer. The reducer never loops,
 * so at most one recommendation and one announcement resolve per message.
 */
export async function advance(input: AdvanceInput): Promise<AdvanceOutput> {
  const { snapshot, replies, effects } = transition(input.snapshot, {
    memberId: input.memberId,
    command: input.interpretation.command,
    rawText: input.interpretation.text,
    preference: input.interpretation.preference,
  });

  const outbound = [...replies];

  for (const effect of effects) {
    if (effect.kind === "RUN_RECOMMENDATION") {
      await resolveRecommendation(
        snapshot,
        outbound,
        input.restaurants,
        input.now,
        input.onDegradation,
        input.cuisineMediator,
      );
    } else if (effect.kind === "ANNOUNCE_WINNER") {
      resolveWinner(snapshot, outbound);
    }
  }

  return { snapshot, replies: outbound };
}

async function resolveRecommendation(
  snapshot: SessionSnapshot,
  outbound: OutboundIntent[],
  restaurants: RestaurantProvider,
  now: Date,
  onDegradation?: (event: string, cause: unknown) => void,
  mediator?: CuisineMediator,
): Promise<void> {
  const preferences = preferenceList(snapshot);

  let found;
  try {
    found = await restaurants.search({
      locationText: snapshot.locationText ?? "",
      radiusMiles: snapshot.radiusMiles,
      now,
    });
  } catch (error) {
    // The group gets a friendly retry, but an operator still needs to know why
    // searches are failing — swallowing this entirely makes a broken key or a
    // rate-limited source indistinguishable from bad luck.
    onDegradation?.("restaurant_search_failed", error);
    // Keep collecting so DONE can simply be sent again once the source
    // recovers; the group's answers are still good.
    snapshot.state = "COLLECTING_PREFERENCES";
    outbound.push({ text: copy.SEARCH_UNAVAILABLE });
    return;
  }

  /**
   * A compromise is offered before ranking, not after: once the group has seen
   * a list it has already started arguing about that list, and the question
   * "would something else suit you all better" arrives too late to be useful.
   *
   * Only asked once per decision, and only when the group is split in a way the
   * scorer cannot bridge — two cuisines in the same family already rank well
   * against each other, so proposing there would spend a model call to change
   * nothing.
   */
  if (
    mediator &&
    snapshot.agreedCuisine == null &&
    snapshot.cuisineProposal == null &&
    isSplitOnCuisine(preferences)
  ) {
    const wanted = statedCuisines(preferences);
    const available = [...new Set(found.restaurants.map((restaurant) => restaurant.cuisine))];
    let proposed: Cuisine | null = null;
    try {
      proposed = await mediator.propose({ wanted, available });
    } catch (error) {
      onDegradation?.("cuisine_mediation_failed", error);
    }

    // A proposal nobody already asked for, that something nearby actually
    // serves. Anything else is not worth interrupting the group to ask about.
    if (proposed && available.includes(proposed) && !wanted.includes(proposed)) {
      snapshot.cuisineProposal = { cuisine: proposed, approvedBy: [], rejectedBy: [] };
      snapshot.state = "AWAITING_CUISINE_APPROVAL";
      outbound.push({ text: copy.proposeCuisine(wanted, proposed) });
      return;
    }
  }

  // An agreed cuisine is applied as something everyone now wants, so it lifts
  // the least-satisfied member rather than being bolted on as an extra voice.
  const effective = snapshot.agreedCuisine
    ? preferences.map((preference) => ({
        ...preference,
        preferredCuisines: [...new Set([...preference.preferredCuisines, snapshot.agreedCuisine as Cuisine])],
      }))
    : preferences;

  const { candidates, needsAllergyDisclaimer, dietaryUnverified } = recommend(found.restaurants, effective, {
    vetoedRestaurantIds: vetoedRestaurantIds(snapshot),
  });

  if (candidates.length === 0) {
    // Keep collecting so the group can loosen a restriction and try again.
    snapshot.state = "COLLECTING_PREFERENCES";
    outbound.push({ text: copy.NO_OPTIONS_FOUND });
    return;
  }

  snapshot.candidates = candidates;
  snapshot.ballots = [];
  snapshot.state = "VOTING";
  // The options message carries a maps URL only in the winner announcement, so
  // the recommendation text itself is safe to send as the chat-opening message.
  outbound.push({
    text: copy.recommendations(
      candidates,
      needsAllergyDisclaimer,
      { sourceLabel: found.sourceLabel, resolvedLocation: found.resolvedLocation },
      dietaryUnverified,
    ),
  });
}

function resolveWinner(snapshot: SessionSnapshot, outbound: OutboundIntent[]): void {
  const preferences = preferenceList(snapshot);
  const outcome = tally(snapshot.candidates, snapshot.ballots);
  if (!outcome.winner) {
    outbound.push({ text: copy.NOTHING_RUNNING });
    return;
  }
  // The winner message contains a directions link, so it must be its own send
  // and never the message that opens a chat.
  outbound.push({
    text: copy.winnerAnnouncement(outcome.winner, outcome.runnerUp, preferences),
    deferLink: true,
  });
}
