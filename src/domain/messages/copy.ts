import {
  formatDistance,
  formatPrice,
  winnerReasons,
  type Candidate,
} from "../recommendations/select";
import type { Restaurant } from "../restaurants/provider";
import type { DietaryRequirement, MemberPreference } from "../types";
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
  "• 1–5 — vote for an option",
  "• VETO 2 — rule an option out",
  "• DETAILS 2 — address, website and links for an option",
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

/**
 * A live restaurant source can rate-limit, time out, or simply be down. That is
 * an outage, not an empty result, and the group needs to know the difference —
 * "nothing matched your restrictions" would send them off loosening preferences
 * that were never the problem.
 */
export const SEARCH_UNAVAILABLE = [
  "I couldn't reach the restaurant listings just now.",
  "",
  "Send DONE to try again, or CANCEL to stop.",
].join("\n");

/**
 * Last resort when a reply was promised but the work behind it threw. Some
 * transports show a pending placeholder the moment a command arrives, and an
 * unanswered one waits forever; saying the attempt failed is strictly better
 * than a spinner that never resolves.
 */
export const REQUEST_FAILED = [
  "Something went wrong on my end and I couldn't finish that.",
  "",
  "Try again in a moment, or send CANCEL to stop.",
].join("\n");

/**
 * Shown when a dietary need was stated and the listings carry no dietary data
 * to check it against. It must read as an admission, not a recommendation: the
 * group is being handed leads to call ahead about, not verified matches.
 */
export const DIETARY_UNVERIFIED =
  "Heads up: none of these list their dietary options, so I couldn't check them " +
  "against what you need. Worth a quick call before you go.";

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

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five"] as const;

/** Small counts read better as words in a text message than as digits. */
function countWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "1, 2, or 3" — the ballot instruction has to match however many options were
 * actually found, which is no longer always three.
 */
export function optionList(count: number): string {
  const numbers = Array.from({ length: Math.max(count, 1) }, (_, index) => String(index + 1));
  if (numbers.length === 1) return numbers[0] as string;
  return `${numbers.slice(0, -1).join(", ")}, or ${numbers.at(-1)}`;
}

export const NO_OPTIONS_YET = "No options on the table yet. Say HEY VIAND to start one.";

/**
 * We have no Yelp API, so this is an honest search link rather than a claim to
 * be the business's Yelp page — the group lands on Yelp's results for this name
 * and address and picks out the right one.
 */
function yelpSearchUrl(restaurant: Restaurant): string {
  const params = new URLSearchParams({ find_desc: restaurant.name });
  if (restaurant.address) params.set("find_loc", restaurant.address);
  return `https://www.yelp.com/search?${params.toString()}`;
}

/**
 * Everything we know about one option, for when the group wants more than the
 * one-line summary. Only states what the source actually published: a missing
 * website or phone is left out rather than rendered as an empty field.
 */
export function placeDetails(restaurant: Restaurant): string {
  const facts = [formatDistance(restaurant.distanceMiles)];
  if (restaurant.priceLevel != null) facts.unshift(formatPrice(restaurant.priceLevel));
  if (isKnownRating(restaurant.rating)) facts.push(star(restaurant.rating));

  const lines = [restaurant.name, facts.join(" · ")];

  if (restaurant.address) lines.push(restaurant.address);
  if (restaurant.accommodates.length > 0) {
    const labels = restaurant.accommodates.map((requirement: DietaryRequirement) =>
      requirement.replace(/_/g, "-"),
    );
    lines.push(`Options for: ${labels.join(", ")}`);
  }
  if (restaurant.phone) lines.push(`Phone: ${restaurant.phone}`);
  if (restaurant.openNow == null) lines.push(unverifiedHours(restaurant.openingHoursRaw));

  lines.push("");
  if (restaurant.website) lines.push(`Website: ${restaurant.website}`);
  lines.push(`Directions: ${restaurant.mapsUrl}`);
  lines.push(`Look up on Yelp: ${yelpSearchUrl(restaurant)}`);

  return lines.join("\n");
}

function unverifiedHours(raw: string | null): string {
  return raw ? `Hours: ${raw} (unverified, call ahead)` : "Hours unverified, call ahead";
}

/**
 * A source with no rating must not be rendered as a rating of zero — "0.0★"
 * reads as terrible rather than as unknown. Both sentinels are checked because
 * `null` is the current shape and `0` is what older fixtures and some sources
 * still carry; either way the star is omitted rather than guessed at.
 */
function isKnownRating(rating: number | null): rating is number {
  return rating != null && rating > 0;
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
  dietaryUnverified = false,
): string {
  const count = candidates.length;
  const noun = `${countWord(count)} option${count === 1 ? "" : "s"}`;
  const heading = attribution.resolvedLocation
    ? `${capitalise(noun)} near ${attribution.resolvedLocation}:`
    : `I found ${noun}:`;
  const lines: string[] = [heading, ""];

  candidates.forEach((candidate, index) => {
    const { restaurant } = candidate;
    const facts = [`${restaurant.distanceMiles.toFixed(1)} mi`];
    if (restaurant.priceLevel != null) facts.push(formatPrice(restaurant.priceLevel));
    if (isKnownRating(restaurant.rating)) facts.push(star(restaurant.rating));
    lines.push(`${index + 1}. ${restaurant.name} — ${facts.join(" · ")}`);
    lines.push(`   ${candidate.explanation}`);
    lines.push("");
  });

  lines.push(`Reply ${optionList(candidates.length)}.`);
  lines.push('Reply “veto 2” if an option cannot work.');
  lines.push('Reply “details 2” to hear more about one.');

  if (needsDisclaimer) {
    lines.push("");
    lines.push(ALLERGY_DISCLAIMER);
  }
  if (dietaryUnverified) {
    lines.push(DIETARY_UNVERIFIED);
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
  lines.push(`Reply ${optionList(standings.length)}, or DONE to close it out.`);
  return lines.join("\n");
}

export function changeInstructions(): string {
  return "Send your new answer and I'll replace your old one.";
}
