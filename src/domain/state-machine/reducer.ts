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
import type { MemberPreference, OptionNumber } from "../types";
import {
  initialSnapshot,
  proposalOutcome,
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
    case "DETAILS":
      // Asking about an option is a question, not a move in the vote, so it is
      // answered in whatever state the session happens to be in.
      return detailsReply(snapshot, command.option);
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
      return inPreferences(snapshot, command, memberId, event.rawText, event.preference ?? null);
    case "AWAITING_CUISINE_APPROVAL":
      return inApproval(snapshot, command, memberId);
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
  preference: MemberPreference | null,
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
      snapshot.preferences[memberId] = preference ?? parsePreference(rawText);
      return result(snapshot, [
        reply(copy.preferencesRecorded(Object.keys(snapshot.preferences).length)),
      ]);
    }
    default:
      return result(snapshot);
  }
}

function detailsReply(
  snapshot: SessionSnapshot,
  option: OptionNumber | null,
): TransitionResult {
  if (snapshot.candidates.length === 0) {
    return result(snapshot, [reply(copy.NO_OPTIONS_YET)]);
  }

  if (option == null) {
    // Once a decision is made, a bare "details" can only mean the winner.
    const leader = tally(snapshot.candidates, snapshot.ballots).standings[0]?.candidate;
    if (snapshot.state === "COMPLETED" && leader) {
      return result(snapshot, [reply(copy.placeDetails(leader.restaurant), true)]);
    }
    return result(snapshot, [
      reply(`Which one? Reply DETAILS ${copy.optionList(snapshot.candidates.length)}.`),
    ]);
  }

  const candidate = snapshot.candidates[option - 1];
  if (!candidate) {
    return result(snapshot, [
      reply(`There's no option ${option}. Reply ${copy.optionList(snapshot.candidates.length)}.`),
    ]);
  }
  return result(snapshot, [reply(copy.placeDetails(candidate.restaurant), true)]);
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
      return result(snapshot, [
        reply(`There's no option ${option}. Reply ${copy.optionList(snapshot.candidates.length)}.`),
      ]);
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
          reply(
            `I need at least two votes before closing. Reply ${copy.optionList(
              snapshot.candidates.length,
            )}.`,
          ),
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

/**
 * While a compromise is on the table.
 *
 * Anything that is not an answer to the proposal gets a reply saying what is
 * being asked rather than being quietly swallowed — a group that does not
 * realise it has been asked a question will sit waiting for options that are
 * not coming.
 */
function inApproval(
  snapshot: SessionSnapshot,
  command: Command,
  memberId: string,
): TransitionResult {
  const proposal = snapshot.cuisineProposal;
  if (!proposal) {
    // Cannot happen through the state machine, but a stored snapshot is data
    // and data can be wrong; recover rather than trust it.
    snapshot.state = "READY_TO_RECOMMEND";
    return result(snapshot, [], [{ kind: "RUN_RECOMMENDATION" }]);
  }

  switch (command.kind) {
    case "APPROVE":
    case "REJECT": {
      const approving = command.kind === "APPROVE";
      // One answer each, and a change of mind replaces the earlier one.
      const approvedBy = proposal.approvedBy.filter((id) => id !== memberId);
      const rejectedBy = proposal.rejectedBy.filter((id) => id !== memberId);
      const updated = {
        cuisine: proposal.cuisine,
        approvedBy: approving ? [...approvedBy, memberId] : approvedBy,
        rejectedBy: approving ? rejectedBy : [...rejectedBy, memberId],
      };
      snapshot.cuisineProposal = updated;

      const outcome = proposalOutcome(updated, snapshot.activeMemberIds.length);
      if (outcome === "undecided") {
        return result(snapshot, [
          reply(copy.proposalTally(updated.approvedBy.length, snapshot.activeMemberIds.length)),
        ]);
      }

      snapshot.agreedCuisine = outcome === "approved" ? updated.cuisine : null;
      snapshot.cuisineProposal = null;
      snapshot.state = "READY_TO_RECOMMEND";
      return result(
        snapshot,
        [reply(outcome === "approved" ? copy.proposalApproved(updated.cuisine) : copy.PROPOSAL_REJECTED)],
        [{ kind: "RUN_RECOMMENDATION" }],
      );
    }
    case "DONE":
      // Someone wants to move on without waiting for the rest.
      snapshot.cuisineProposal = null;
      snapshot.state = "READY_TO_RECOMMEND";
      return result(snapshot, [reply(copy.PROPOSAL_REJECTED)], [{ kind: "RUN_RECOMMENDATION" }]);
    case "CHANGE":
      snapshot.cuisineProposal = null;
      snapshot.agreedCuisine = null;
      snapshot.state = "COLLECTING_PREFERENCES";
      return result(snapshot, [reply(copy.ASK_PREFERENCES)]);
    case "STATUS":
      return result(snapshot, [
        reply(copy.proposalTally(proposal.approvedBy.length, snapshot.activeMemberIds.length)),
      ]);
    default:
      return result(snapshot, [reply(copy.proposalPending(proposal.cuisine))]);
  }
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
