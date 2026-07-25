import { formatPrice, winnerReasons, type Candidate } from "../recommendations/select";
import type { MemberPreference } from "../types";
import type { Standing } from "../voting/tally";

/**
 * Every outbound string the bot can produce. Kept in one module so the tone
 * stays consistent and so tests assert against copy rather than against string
 * literals scattered through the state machine.
 *
 * Bot messages are deliberately sparse: in a group chat every message buzzes
 * every phone, so the bot speaks on state transitions and stays quiet while
 * collecting individual answers.
 */

export const ONBOARDING = [
  "Hey! I help groups agree on where to eat.",
  "",
  'Add this number to your iMessage group, then say “Hey Viand.”',
  "",
  "Send HELP anytime for instructions.",
].join("\n");

export const HELP = [
  "Here's how I work:",
  "",
  "• HEY VIAND — start a new decision",
  "• DONE — finish preferences, or close voting",
  "• STATUS — see where things stand",
  "• CHANGE — redo your answer",
  "• CANCEL — stop this decision",
  "• 1, 2, 3 — vote for an option",
  "• VETO 2 — rule an option out",
  "",
  "Send STOP to opt out of messages at any time.",
].join("\n");

export const ASK_LOCATION = [
  "Let's pick somewhere everyone can enjoy.",
  "",
  "First: what area should I search near? Send a neighborhood, ZIP code, or address.",
].join("\n");

export const ASK_PREFERENCES = [
  "Everyone send what you want in one message.",
  "",
  "Examples:",
  "• Mexican or Korean, under $25",
  "• Vegetarian, within 15 minutes",
  "• Anything except seafood",
  "",
  "Send DONE when everyone has answered.",
].join("\n");

export const ALLERGY_DISCLAIMER =
  "Restaurant information may be incomplete. Confirm serious allergies directly with the restaurant.";

export const NO_OPTIONS_FOUND = [
  "I couldn't find anywhere that works for everyone's restrictions.",
  "",
  "Send CHANGE to adjust an answer, or CANCEL to stop.",
].join("\n");

export const CANCELLED = "Cancelled. Say HEY VIAND whenever you want to try again.";

export const ALREADY_RUNNING =
  "We already have a decision going. Send STATUS to see where we are, or CANCEL to start over.";

export const NOTHING_RUNNING = "Nothing going right now. Say HEY VIAND to start.";

export const OPTED_OUT =
  "You're opted out and won't get more messages from me. Send START to opt back in.";

export const OPTED_IN = "You're back in. Say HEY VIAND to start a decision.";

export const LOCATION_NOT_UNDERSTOOD =
  "I need an area to search near — a neighborhood, ZIP code, or address works.";

export function preferencesRecorded(memberCount: number): string {
  return memberCount === 1
    ? "Got it. Send DONE when everyone has answered."
    : `Got ${memberCount} answers. Send DONE when everyone has answered.`;
}

export function needMorePreferences(): string {
  return "I need at least one answer before I can suggest anywhere. Send what you're after.";
}

function star(rating: number): string {
  return `${rating.toFixed(1)}★`;
}

/** Where the options came from, so the group is never misled about the data. */
export interface SearchAttribution {
  sourceLabel: string;
  resolvedLocation: string | null;
}

export function recommendations(
  candidates: readonly Candidate[],
  needsDisclaimer: boolean,
  attribution: SearchAttribution,
): string {
  const heading = attribution.resolvedLocation
    ? `Three options near ${attribution.resolvedLocation}:`
    : "I found three options:";
  const lines: string[] = [heading, ""];

  candidates.forEach((candidate, index) => {
    const { restaurant } = candidate;
    lines.push(
      `${index + 1}. ${restaurant.name} — ${restaurant.distanceMiles.toFixed(1)} mi · ` +
        `${formatPrice(restaurant.priceLevel)} · ${star(restaurant.rating)}`,
    );
    lines.push(`   ${candidate.explanation}`);
    lines.push("");
  });

  lines.push("Reply 1, 2, or 3.");
  lines.push('Reply “veto 2” if an option cannot work.');

  if (needsDisclaimer) {
    lines.push("");
    lines.push(ALLERGY_DISCLAIMER);
  }

  lines.push("");
  lines.push(attribution.sourceLabel);

  return lines.join("\n");
}

export function winnerAnnouncement(
  winner: Standing,
  runnerUp: Standing | null,
  preferences: readonly MemberPreference[],
): string {
  const { restaurant } = winner.candidate;
  const scoreLine =
    runnerUp && winner.votes > 0
      ? `${restaurant.name} wins ${winner.votes}–${runnerUp.votes}.`
      : `${restaurant.name} it is.`;

  const lines = [scoreLine, "", "Why it fits:"];
  for (const reason of winnerReasons(winner.candidate, preferences)) {
    lines.push(`• ${reason}`);
  }
  lines.push("");
  lines.push(`Address: ${restaurant.address}`);
  lines.push(`Directions: ${restaurant.mapsUrl}`);

  return lines.join("\n");
}

export function statusCollectingLocation(): string {
  return "Waiting on an area to search near. Send a neighborhood, ZIP code, or address.";
}

export function statusCollectingPreferences(answered: number, active: number): string {
  return `${answered} of ${active} people have answered. Send DONE when everyone has.`;
}

export function statusVoting(standings: readonly Standing[], votedCount: number): string {
  const lines = [`${votedCount} ${votedCount === 1 ? "vote" : "votes"} in so far:`, ""];
  standings.forEach((standing, index) => {
    const vetoNote = standing.vetoes > 0 ? ` (${standing.vetoes} veto)` : "";
    lines.push(`${index + 1}. ${standing.candidate.restaurant.name} — ${standing.votes}${vetoNote}`);
  });
  lines.push("");
  lines.push("Reply 1, 2, or 3, or DONE to close it out.");
  return lines.join("\n");
}

export function changeInstructions(): string {
  return "Send your new answer and I'll replace your old one.";
}
