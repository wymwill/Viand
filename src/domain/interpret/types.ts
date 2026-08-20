import { z } from "zod";
import type { Command } from "../commands";
import {
  ALLERGY_REQUIREMENTS,
  CUISINES,
  DIETARY_REQUIREMENTS,
  emptyPreference,
  type Cuisine,
  type DecisionState,
  type DietaryRequirement,
  type MemberPreference,
  type OptionNumber,
  type PriceLevel,
} from "../types";

/**
 * The interpretation layer turns one raw message into the two things the state
 * machine needs: a command and, when the message carried one, a preference.
 *
 * Everything in this module is pure. The AI-backed implementation lives in
 * `src/lib/interpret` because it performs I/O; what lives here is the contract,
 * the wire schema, and the mapping from model output back into domain types.
 */

export interface Interpretation {
  /** The original message text, preserved verbatim. */
  text: string;
  command: Command;
  /** Parsed preference when the message carried one; null otherwise. */
  preference: MemberPreference | null;
  /** Which layer produced this. Diagnostics only — never changes behaviour. */
  source: "rules" | "ai";
}

export interface InterpretInput {
  text: string;
  /**
   * Deterministic parse of the same text. Anything other than FREEFORM is
   * authoritative and must not be second-guessed by a model — a vote, a veto,
   * DONE and CANCEL all have exact spellings, and getting them wrong is worse
   * than not understanding a sentence.
   */
  command: Command;
  /** What the session is currently waiting for. */
  state: DecisionState;
  /** Names of the options on the table. Present only while voting. */
  optionNames?: readonly string[];
  /**
   * Which conversation this came from. Carried so spend can be bounded per
   * chat; the interpreter itself never uses it to decide meaning.
   */
  chatId?: string;
}

export interface MessageInterpreter {
  interpret(input: InterpretInput): Promise<Interpretation>;
}

/**
 * Intents the model may return. STOP and START are deliberately absent: carrier
 * compliance keywords are matched exactly, before any interpretation runs, and
 * must never depend on a model being available or correct.
 */
export const INTERPRETER_INTENTS = [
  "PICK_A_PLACE",
  "VOTE",
  "VETO",
  "DETAILS",
  "DONE",
  "STATUS",
  "CHANGE",
  "CANCEL",
  "HELP",
  "LOCATION",
  "PREFERENCE",
  "CHATTER",
] as const;

export type InterpreterIntent = (typeof INTERPRETER_INTENTS)[number];

/**
 * Strict JSON schema handed to the model. Sentinel zeroes stand in for "not
 * stated" so every field is required and non-nullable — strict mode rejects
 * open objects, and a closed schema with sentinels is easier for a small model
 * to satisfy than nullable unions.
 */
export const INTERPRETATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: [...INTERPRETER_INTENTS] },
    /** 1–5 for VOTE/VETO, 0 when no option was named. */
    option: { type: "integer", enum: [0, 1, 2, 3, 4, 5] },
    preference: {
      type: "object",
      properties: {
        preferredCuisines: { type: "array", items: { type: "string", enum: [...CUISINES] } },
        excludedCuisines: { type: "array", items: { type: "string", enum: [...CUISINES] } },
        dietary: {
          type: "array",
          items: { type: "string", enum: [...DIETARY_REQUIREMENTS] },
        },
        /** 1–4, or 0 when no budget was stated. */
        maxPriceLevel: { type: "integer", enum: [0, 1, 2, 3, 4] },
        /** Miles, or 0 when no distance was stated. */
        maxDistanceMiles: { type: "number" },
        noPreference: { type: "boolean" },
        hasAllergyConcern: { type: "boolean" },
      },
      required: [
        "preferredCuisines",
        "excludedCuisines",
        "dietary",
        "maxPriceLevel",
        "maxDistanceMiles",
        "noPreference",
        "hasAllergyConcern",
      ],
      additionalProperties: false,
    },
    /** 0–1. Below the configured floor the deterministic parse is used. */
    confidence: { type: "number" },
  },
  required: ["intent", "option", "preference", "confidence"],
  additionalProperties: false,
} as const;

/**
 * Runtime guard for the model's output. The schema is enforced server-side, but
 * a malformed or truncated response must degrade to the rules parser rather
 * than throw, so nothing downstream ever sees an unvalidated shape.
 */
const modelOutputSchema = z.object({
  intent: z.enum(INTERPRETER_INTENTS),
  option: z.number().int().min(0).max(5),
  preference: z.object({
    preferredCuisines: z.array(z.enum(CUISINES)),
    excludedCuisines: z.array(z.enum(CUISINES)),
    dietary: z.array(z.enum(DIETARY_REQUIREMENTS)),
    maxPriceLevel: z.number().int().min(0).max(4),
    maxDistanceMiles: z.number().min(0),
    noPreference: z.boolean(),
    hasAllergyConcern: z.boolean(),
  }),
  confidence: z.number(),
});

export type InterpreterModelOutput = z.infer<typeof modelOutputSchema>;

function commandFromIntent(output: InterpreterModelOutput, input: InterpretInput): Command | null {
  switch (output.intent) {
    case "VOTE":
    case "VETO": {
      // A ballot only means something while options are on the table, and an
      // intent of VOTE with no option number is not a usable answer.
      if (output.option === 0 || input.state !== "VOTING") return null;
      const option = output.option as OptionNumber;
      return output.intent === "VOTE" ? { kind: "VOTE", option } : { kind: "VETO", option };
    }
    case "DETAILS":
      return {
        kind: "DETAILS",
        option: output.option === 0 ? null : (output.option as OptionNumber),
      };
    case "PICK_A_PLACE":
      return { kind: "PICK_A_PLACE" };
    case "DONE":
      return { kind: "DONE" };
    case "STATUS":
      return { kind: "STATUS" };
    case "CHANGE":
      return { kind: "CHANGE" };
    case "CANCEL":
      return { kind: "CANCEL" };
    case "HELP":
      return { kind: "HELP" };
    case "LOCATION":
    case "PREFERENCE":
    case "CHATTER":
      // Free text. The state machine already routes it by state, so the model
      // does not get to decide whether a sentence is a location or an answer.
      return { kind: "FREEFORM", text: input.text };
  }
}

/**
 * Null when the model extracted nothing at all, which lets the caller fall back
 * to the rules parser instead of storing an empty preference.
 */
function preferenceFromModel(
  raw: InterpreterModelOutput["preference"],
  text: string,
): MemberPreference | null {
  const excludedCuisines: Cuisine[] = [...new Set(raw.excludedCuisines)];
  const preferredCuisines: Cuisine[] = [...new Set(raw.preferredCuisines)].filter(
    (cuisine) => !excludedCuisines.includes(cuisine),
  );
  const dietary: DietaryRequirement[] = [...new Set(raw.dietary)];

  const statedNothing =
    preferredCuisines.length === 0 &&
    excludedCuisines.length === 0 &&
    dietary.length === 0 &&
    raw.maxPriceLevel === 0 &&
    raw.maxDistanceMiles === 0 &&
    !raw.noPreference;
  if (statedNothing) return null;

  const preference = emptyPreference(text);
  preference.preferredCuisines = preferredCuisines;
  preference.excludedCuisines = excludedCuisines;
  preference.dietary = dietary;
  preference.maxPriceLevel = raw.maxPriceLevel === 0 ? null : (raw.maxPriceLevel as PriceLevel);
  preference.maxDistanceMiles = raw.maxDistanceMiles > 0 ? raw.maxDistanceMiles : null;
  preference.noPreference = raw.noPreference && preferredCuisines.length === 0;
  // Err toward the disclaimer on the same terms as the rules parser.
  preference.hasAllergyConcern =
    raw.hasAllergyConcern ||
    dietary.some((requirement) => ALLERGY_REQUIREMENTS.includes(requirement));

  return preference;
}

/**
 * Validates raw model output and maps it into domain types. Returns null for
 * anything unusable — wrong shape, low confidence, or an intent that cannot
 * apply in the current state — which the caller reads as "use the fallback".
 */
export function interpretationFromModel(
  raw: unknown,
  input: InterpretInput,
  minConfidence: number,
): Interpretation | null {
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  if (parsed.data.confidence < minConfidence) return null;

  const command = commandFromIntent(parsed.data, input);
  if (command == null) return null;

  return {
    text: input.text,
    command,
    preference: preferenceFromModel(parsed.data.preference, input.text),
    source: "ai",
  };
}
