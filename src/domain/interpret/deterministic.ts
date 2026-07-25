import { parsePreference } from "../preferences/rules-parser";
import type { InterpretInput, Interpretation, MessageInterpreter } from "./types";

/**
 * The always-available interpretation: the deterministic command parser plus
 * the rules preference parser. It never fails, never blocks on a network call,
 * and is what every other implementation falls back to.
 */
export class DeterministicInterpreter implements MessageInterpreter {
  async interpret(input: InterpretInput): Promise<Interpretation> {
    return deterministicInterpretation(input);
  }
}

export function deterministicInterpretation(input: InterpretInput): Interpretation {
  const isPreferenceTurn =
    input.command.kind === "FREEFORM" && input.state === "COLLECTING_PREFERENCES";

  return {
    text: input.text,
    command: input.command,
    preference: isPreferenceTurn ? parsePreference(input.text) : null,
    source: "rules",
  };
}
