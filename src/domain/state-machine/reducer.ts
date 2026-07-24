import type { Command } from "../commands";
import * as copy from "../messages/copy";
import { parsePreference } from "../preferences/rules-parser";
import {
  allActiveMembersVoted,
  canForceClose,
  tally,
  voterCount,
  type Ballot,
} from "../voting/tally";
import type { OptionNumber } from "../types";
import {
  initialSnapshot,
  type Effect,
  type InboundEvent,
  type OutboundIntent,
  type SessionSnapshot,
  type TransitionResult,
} from "./session";

function clone(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    ...snapshot,
    preferences: { ...snapshot.preferences },
    activeMemberIds: [...snapshot.activeMemberIds],
    candidates: [...snapshot.candidates],
    ballots: [...snapshot.ballots],
  };
}

function reply(text: string, deferLink = false): OutboundIntent {
  return deferLink ? { text, deferLink: true } : { text };
}

function result(
  snapshot: SessionSnapshot,
  replies: OutboundIntent[] = [],
  effects: Effect[] = [],
): TransitionResult {
  return { snapshot, replies, effects };
}

function touchMember(snapshot: SessionSnapshot, memberId: string): void {
  if (!snapshot.activeMemberIds.includes(memberId)) snapshot.activeMemberIds.push(memberId);
}

/** Location is the first non-empty free-text message the group sends. */
function looksLikeLocation(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * The single entry point for advancing a session. Pure and total: every command
 * is handled in every state, so an out-of-context command produces a helpful
 * reply rather than a crash or a silent no-op. Callers persist the returned
 * snapshot and perform the returned effects.
 */
export function transition(previous: SessionSnapshot, event: InboundEvent): TransitionResult {
  const snapshot = clone(previous);
  const { command, memberId } = event;

  // Commands that behave the same regardless of state come first.
  switch (command.kind) {
    case "STOP":
      // Opt-out is handled at the messaging layer (per-user, cross-session);
      // the machine just acknowledges without changing session state.
      return result(snapshot, [reply(copy.OPTED_OUT)]);
    case "START":
      return result(snapshot, [reply(copy.OPTED_IN)]);
    case "HELP":
      return result(snapshot, [reply(copy.HELP)]);
    case "CANCEL":
      if (snapshot.state === "COMPLETED" || snapshot.state === "CANCELLED") {
        return result(snapshot, [reply(copy.NOTHING_RUNNING)]);
      }
      snapshot.state = "CANCELLED";
      return result(snapshot, [reply(copy.CANCELLED)]);
    default:
      break;
  }

  switch (snapshot.state) {
    case "COLLECTING_LOCATION":
      return inLocation(snapshot, command, memberId);
    case "COLLECTING_PREFERENCES":
      return inPreferences(snapshot, command, memberId, event.rawText);
    case "READY_TO_RECOMMEND":
      // Transient: the caller runs the recommendation effect and moves us on.
      return result(snapshot, [], [{ kind: "RUN_RECOMMENDATION" }]);
    case "VOTING":
      return inVoting(snapshot, command, memberId);
    case "COMPLETED":
    case "CANCELLED":
      return inTerminal(snapshot, command, memberId);
    default:
      return result(snapshot);
  }
}

function inLocation(
  snapshot: SessionSnapshot,
  command: Command,
  memberId: string,
): TransitionResult {
  touchMember(snapshot, memberId);

  switch (command.kind) {
    case "PICK_A_PLACE":
      // Already collecting location — re-prompt rather than restart.
      return result(snapshot, [reply(copy.ASK_LOCATION)]);
    case "STATUS":
      return result(snapshot, [reply(copy.statusCollectingLocation())]);
    case "FREEFORM": {
      if (!looksLikeLocation(command.text)) {
        return result(snapshot, [reply(copy.LOCATION_NOT_UNDERSTOOD)]);
      }
      snapshot.locationText = command.text.trim();
      snapshot.state = "COLLECTING_PREFERENCES";
      return result(snapshot, [reply(copy.ASK_PREFERENCES)]);
    }
    default:
      return result(snapshot, [reply(copy.statusCollectingLocation())]);
  }
}

function inPreferences(
  snapshot: SessionSnapshot,
  command: Command,
  memberId: string,
  rawText: string,
): TransitionResult {
  touchMember(snapshot, memberId);

  switch (command.kind) {
    case "DONE": {
      const answered = Object.keys(snapshot.preferences).length;
      if (answered === 0) {
        return result(snapshot, [reply(copy.needMorePreferences())]);
      }
      snapshot.state = "READY_TO_RECOMMEND";
      return result(snapshot, [], [{ kind: "RUN_RECOMMENDATION" }]);
    }
    case "STATUS":
      return result(snapshot, [
        reply(
          copy.statusCollectingPreferences(
            Object.keys(snapshot.preferences).length,
            snapshot.activeMemberIds.length,
          ),
        ),
      ]);
    case "CHANGE":
      // Members change a preference simply by sending a new one; the latest
      // message for a member replaces the previous. Acknowledge and wait.
      return result(snapshot, [reply(copy.changeInstructions())]);
    case "PICK_A_PLACE":
      return result(snapshot, [reply(copy.ASK_PREFERENCES)]);
    case "FREEFORM": {
      // Every free-text message here is that member's preference. A later one
      // overwrites an earlier one, which is how "change my answer" works.
      snapshot.preferences[memberId] = parsePreference(rawText);
      return result(snapshot, [
        reply(copy.preferencesRecorded(Object.keys(snapshot.preferences).length)),
      ]);
    }
    default:
      return result(snapshot);
  }
}

function inVoting(
  snapshot: SessionSnapshot,
  command: Command,
  memberId: string,
): TransitionResult {
  touchMember(snapshot, memberId);

  const castBallot = (option: OptionNumber, veto: boolean): TransitionResult => {
    const candidate = snapshot.candidates[option - 1];
    if (!candidate) {
      return result(snapshot, [reply(`There's no option ${option}. Reply 1, 2, or 3.`)]);
    }
    const ballot: Ballot = { memberId, candidateId: candidate.restaurant.id, veto };
    snapshot.ballots.push(ballot);
    return maybeCloseVoting(snapshot, false);
  };

  switch (command.kind) {
    case "VOTE":
      return castBallot(command.option, false);
    case "VETO":
      return castBallot(command.option, true);
    case "DONE":
      if (!canForceClose(snapshot.ballots)) {
        return result(snapshot, [
          reply("I need at least two votes before closing. Reply 1, 2, or 3."),
        ]);
      }
      return maybeCloseVoting(snapshot, true);
    case "STATUS": {
      const standings = tally(snapshot.candidates, snapshot.ballots).standings;
      return result(snapshot, [reply(copy.statusVoting(standings, voterCount(snapshot.ballots)))]);
    }
    case "PICK_A_PLACE":
      return result(snapshot, [reply(copy.ALREADY_RUNNING)]);
    default:
      return result(snapshot);
  }
}

/**
 * Closes voting when the group is done — either forced via DONE (already gated
 * by the caller) or because every active member has voted. Emits the announce
 * effect so the caller can render the winner with fully-scored candidates.
 */
function maybeCloseVoting(snapshot: SessionSnapshot, forced: boolean): TransitionResult {
  const everyoneVoted = allActiveMembersVoted(snapshot.activeMemberIds, snapshot.ballots);
  if (forced || everyoneVoted) {
    snapshot.state = "COMPLETED";
    return result(snapshot, [], [{ kind: "ANNOUNCE_WINNER" }]);
  }
  return result(snapshot);
}

function inTerminal(
  snapshot: SessionSnapshot,
  command: Command,
  memberId: string,
): TransitionResult {
  if (command.kind === "PICK_A_PLACE") {
    // A finished or cancelled session can always be restarted in place.
    const fresh = initialSnapshot(snapshot.isGroup);
    touchMember(fresh, memberId);
    return result(fresh, [reply(copy.ASK_LOCATION)]);
  }
  if (command.kind === "STATUS") {
    return result(snapshot, [reply(copy.NOTHING_RUNNING)]);
  }
  return result(snapshot, [reply(copy.NOTHING_RUNNING)]);
}
