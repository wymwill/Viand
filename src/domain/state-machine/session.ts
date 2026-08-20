import type { Command } from "../commands";
import type { Candidate } from "../recommendations/select";
import type { Cuisine } from "../types";
import type { DecisionState, MemberPreference } from "../types";
import type { Ballot } from "../voting/tally";

/**
 * The full decision session as the state machine sees it. This is a plain data
 * snapshot: the reducer reads one of these and returns a new one, so the same
 * logic runs identically over an in-memory object in tests and over a row
 * hydrated from Postgres in production.
 */
export interface SessionSnapshot {
  state: DecisionState;
  isGroup: boolean;
  locationText: string | null;
  radiusMiles: number;
  /** Preference per member, keyed by the member's stable id (Linq handle). */
  preferences: Record<string, MemberPreference>;
  /** Every member we have heard from this session, in first-seen order. */
  activeMemberIds: string[];
  candidates: Candidate[];
  ballots: Ballot[];
  /**
   * A compromise cuisine put to the group, and who has answered it.
   *
   * Held on the snapshot rather than inferred, because the answer has to
   * survive the gap between messages: each member replies in their own
   * message, on their own device, and any of those may be the one that reaches
   * the majority.
   */
  cuisineProposal: CuisineProposal | null;
  /**
   * A cuisine the group agreed to try. Applied when ranking, never written back
   * over what anybody said: `originalMessage` and the stated preferences stay
   * exactly as given, so a later CHANGE still means what the member meant.
   */
  agreedCuisine: Cuisine | null;
}

export interface CuisineProposal {
  readonly cuisine: Cuisine;
  readonly approvedBy: readonly string[];
  readonly rejectedBy: readonly string[];
}

/**
 * A proposal carries when at least half the members in the session approve it.
 *
 * Half rather than a plurality of whoever answered: a lone yes with everyone
 * else silent is not a group agreeing, it is one person deciding. Counting
 * against the session's members also means the proposal resolves the moment
 * enough people have spoken, instead of waiting on the quiet ones.
 */
export function proposalOutcome(
  proposal: CuisineProposal,
  memberCount: number,
): "approved" | "rejected" | "undecided" {
  const needed = Math.ceil(Math.max(memberCount, 1) / 2);
  if (proposal.approvedBy.length >= needed) return "approved";
  if (proposal.rejectedBy.length >= needed) return "rejected";
  return "undecided";
}

export const DEFAULT_RADIUS_MILES = 5;

export function initialSnapshot(isGroup: boolean): SessionSnapshot {
  return {
    state: "COLLECTING_LOCATION",
    isGroup,
    locationText: null,
    radiusMiles: DEFAULT_RADIUS_MILES,
    preferences: {},
    activeMemberIds: [],
    candidates: [],
    ballots: [],
    cuisineProposal: null,
    agreedCuisine: null,
  };
}

/** A single inbound message, already parsed, attributed to a member. */
export interface InboundEvent {
  memberId: string;
  command: Command;
  /** Raw text, needed when the command is FREEFORM and must be parsed as data. */
  rawText: string;
  /**
   * Preference already extracted from `rawText` by the interpretation layer.
   * Null when nothing was extracted, in which case the reducer parses the raw
   * text itself — so the machine stays correct with no interpreter at all.
   */
  preference?: MemberPreference | null;
}

/**
 * One user-visible reply the machine wants sent. `deferLink` marks a message
 * whose URL must be split into a follow-up send, because Linq forbids a URL in
 * the message that first creates a chat.
 */
export interface OutboundIntent {
  text: string;
  deferLink?: boolean;
}

/** Side effects the machine cannot perform itself (they need I/O). */
export type Effect =
  | { kind: "RUN_RECOMMENDATION" }
  | { kind: "ANNOUNCE_WINNER" };

export interface TransitionResult {
  snapshot: SessionSnapshot;
  replies: OutboundIntent[];
  effects: Effect[];
}
