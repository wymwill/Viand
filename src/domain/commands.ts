import type { OptionNumber } from "./types";

export type Command =
  | { kind: "EAT" }
  | { kind: "HELP" }
  | { kind: "PICK_A_PLACE" }
  | { kind: "DONE" }
  | { kind: "STATUS" }
  | { kind: "CHANGE" }
  | { kind: "CANCEL" }
  | { kind: "VOTE"; option: OptionNumber }
  | { kind: "VETO"; option: OptionNumber }
  /** Null when they asked for details without saying which option. */
  | { kind: "DETAILS"; option: OptionNumber | null }
  | { kind: "STOP" }
  | { kind: "START" }
  /** Anything that is not a command — preference text, location text, chatter. */
  | { kind: "FREEFORM"; text: string };

export type CommandKind = Command["kind"];

/**
 * Lowercases, drops apostrophes so "i'm" and "im" collapse, and turns every
 * other non-alphanumeric run into a single space. Digits survive so "veto2" and
 * "veto 2" normalize to forms the same pattern can match.
 */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Carrier opt-out keywords. Deliberately narrower than the full carrier list:
 * CANCEL, END and QUIT are also conventional opt-out words, but this product
 * assigns CANCEL to ending a decision session. On a live carrier route those
 * words may be intercepted upstream before Linq delivers them — see README.
 */
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe"]);
const START_WORDS = new Set(["start", "unstop", "resume", "subscribe"]);

const WAKE_GREETINGS = new Set(["hey", "hi", "hello", "yo", "ok", "okay"]);
const WAKE_REQUESTS = new Set([
  "",
  "pick",
  "pick a place",
  "pick a spot",
  "pick somewhere",
  "please pick a place",
  "can you pick a place",
  "help us pick a place",
  "help us decide",
  "decide for us",
  "you pick",
  "lets eat",
  "where should we eat",
  "where are we eating",
  "where to eat",
  "find us food",
  "were hungry",
  "im hungry",
  "start",
  "start a session",
]);

/**
 * True only for an intentional invocation of the bot. Punctuation and an
 * optional @ mention are removed by normalize(), so “Hey, @Viand!” and
 * “viand” intentionally behave the same.
 */
export function isWakePhrase(raw: string): boolean {
  const words = normalize(raw).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  if (WAKE_GREETINGS.has(words[0] ?? "")) words.shift();
  if (words.shift() !== "viand") return false;
  return WAKE_REQUESTS.has(words.join(" "));
}

const EXACT_ALIASES: ReadonlyArray<readonly [ReadonlySet<string>, CommandKind]> = [
  [new Set(["eat", "eats", "food"]), "EAT"],
  [new Set(["help", "info", "commands", "how does this work"]), "HELP"],
  [
    new Set([
      "pick a place",
      "pickaplace",
      "pick",
      "lets eat",
      "lets pick a place",
      "where should we eat",
      "where are we eating",
    ]),
    "PICK_A_PLACE",
  ],
  [
    new Set(["done", "im done", "all done", "thats everyone", "that s everyone", "finished", "were done"]),
    "DONE",
  ],
  [new Set(["status", "where are we", "whats the status", "score"]), "STATUS"],
  [new Set(["change", "redo", "change my answer", "change mine", "edit"]), "CHANGE"],
  [new Set(["cancel", "nevermind", "never mind", "forget it", "end", "quit"]), "CANCEL"],
];

/** "1", "#1", "option 1", "i vote 1", "number 1" all normalize into this. */
const VOTE_PATTERN = /^(?:(?:i\s+)?vote(?:\s+for)?|option|number|choice)?\s*([1-5])$/;

/**
 * "details 2", "more about 2", "tell me more about 3", or a bare "details".
 * Checked after the exact aliases so a lone "info" stays HELP, and before the
 * vote patterns so "option 2 details" is not read as a ballot.
 */
const DETAILS_PATTERN =
  /^(?:tell me more(?:\s+about)?|tell me about|more info(?:rmation)?|more about|details?|info)\s*(?:about|on|for)?\s*(?:option|number)?\s*([1-5])?$/;

/** "veto 2", "veto2", "veto #2", "i veto 2". */
const VETO_PATTERN = /^(?:i\s+)?veto(?:\s+for)?\s*([1-5])$/;

export function parseCommand(raw: string): Command {
  const text = normalize(raw);

  if (text.length === 0) return { kind: "FREEFORM", text: raw };

  // Compliance keywords win over everything else, always.
  if (STOP_WORDS.has(text)) return { kind: "STOP" };
  if (START_WORDS.has(text)) return { kind: "START" };
  if (isWakePhrase(raw)) return { kind: "PICK_A_PLACE" };

  for (const [aliases, kind] of EXACT_ALIASES) {
    if (aliases.has(text)) return { kind } as Command;
  }

  const details = DETAILS_PATTERN.exec(text);
  if (details) {
    const option = details[1] ? (Number(details[1]) as OptionNumber) : null;
    return { kind: "DETAILS", option };
  }

  const veto = VETO_PATTERN.exec(text);
  if (veto?.[1]) return { kind: "VETO", option: Number(veto[1]) as OptionNumber };

  const vote = VOTE_PATTERN.exec(text);
  if (vote?.[1]) return { kind: "VOTE", option: Number(vote[1]) as OptionNumber };

  return { kind: "FREEFORM", text: raw };
}

/**
 * What a command means in a chat with no decision running — either because one
 * never started or because the last one finished or was cancelled.
 *
 * - `activate` starts a session. Only an intentional invocation qualifies: a
 *   wake phrase ("@Viand", "Hey Viand") or an explicit "pick a place", both of
 *   which parseCommand maps to PICK_A_PLACE.
 * - `answer` is replied to without creating any session state. HELP is
 *   advertised as always available, and CANCEL deserves an answer rather than
 *   silence; neither should leave an idle chat mid-session.
 * - `ignore` is everything else. A group chat is full of messages that are not
 *   addressed to the bot, and answering them is the fastest way to get muted.
 */
export function idleDisposition(command: Command, wasInvoked = false): "activate" | "answer" | "ignore" {
  if (command.kind === "HELP" || command.kind === "CANCEL") return "answer";
  if (command.kind === "PICK_A_PLACE" || wasInvoked) return "activate";
  return "ignore";
}
