import type { Command } from "../commands";
import type { Candidate } from "../recommendations/select";
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
