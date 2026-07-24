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
const VOTE_PATTERN = /^(?:(?:i\s+)?vote(?:\s+for)?|option|number|choice)?\s*([123])$/;

/** "veto 2", "veto2", "veto #2", "i veto 2". */
const VETO_PATTERN = /^(?:i\s+)?veto(?:\s+for)?\s*([123])$/;

export function parseCommand(raw: string): Command {
  const text = normalize(raw);

  if (text.length === 0) return { kind: "FREEFORM", text: raw };

  // Compliance keywords win over everything else, always.
  if (STOP_WORDS.has(text)) return { kind: "STOP" };
  if (START_WORDS.has(text)) return { kind: "START" };

  for (const [aliases, kind] of EXACT_ALIASES) {
    if (aliases.has(text)) return { kind } as Command;
  }

  const veto = VETO_PATTERN.exec(text);
  if (veto?.[1]) return { kind: "VETO", option: Number(veto[1]) as OptionNumber };

  const vote = VOTE_PATTERN.exec(text);
  if (vote?.[1]) return { kind: "VOTE", option: Number(vote[1]) as OptionNumber };

  return { kind: "FREEFORM", text: raw };
}
