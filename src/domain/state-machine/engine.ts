import { parseCommand } from "../commands";
import * as copy from "../messages/copy";
import { recommend } from "../recommendations/select";
import type { RestaurantProvider } from "../restaurants/provider";
import { tally } from "../voting/tally";
import { transition } from "./reducer";
import type { OutboundIntent, SessionSnapshot } from "./session";

export interface AdvanceInput {
  snapshot: SessionSnapshot;
  memberId: string;
  text: string;
  restaurants: RestaurantProvider;
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
  const command = parseCommand(input.text);
  const { snapshot, replies, effects } = transition(input.snapshot, {
    memberId: input.memberId,
    command,
    rawText: input.text,
  });

  const outbound = [...replies];

  for (const effect of effects) {
    if (effect.kind === "RUN_RECOMMENDATION") {
      await resolveRecommendation(snapshot, outbound, input.restaurants);
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
): Promise<void> {
  const preferences = preferenceList(snapshot);
  const found = await restaurants.search({
    locationText: snapshot.locationText ?? "",
    radiusMiles: snapshot.radiusMiles,
  });

  const { candidates, needsAllergyDisclaimer } = recommend(found, preferences, {
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
  outbound.push({ text: copy.recommendations(candidates, needsAllergyDisclaimer) });
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
