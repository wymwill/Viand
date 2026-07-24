import type { MemberPreference } from "../types";

/**
 * Behind an interface so a future LLM-backed parser can replace the rules
 * engine without touching the state machine. Phase 1 ships rules only — no LLM
 * dependency — and the rules parser is synchronous under this async signature.
 */
export interface PreferenceParser {
  parse(message: string): Promise<MemberPreference>;
}
