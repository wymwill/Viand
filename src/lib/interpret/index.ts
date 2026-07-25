import Anthropic from "@anthropic-ai/sdk";
import { DeterministicInterpreter } from "@/domain/interpret/deterministic";
import type { MessageInterpreter } from "@/domain/interpret/types";
import { getEnv } from "../env";
import { ClaudeInterpreter } from "./claude-interpreter";

let singleton: MessageInterpreter | null = null;

/**
 * The interpreter the live webhook path should use. Held as a singleton so the
 * Anthropic client's connection pool is reused across requests.
 */
export function getMessageInterpreter(): MessageInterpreter {
  if (singleton) return singleton;

  const env = getEnv();
  if (!env.USE_AI_INTERPRETER || !env.ANTHROPIC_API_KEY) {
    singleton = new DeterministicInterpreter();
    return singleton;
  }

  singleton = new ClaudeInterpreter({
    client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
    model: env.AI_INTERPRETER_MODEL,
    timeoutMs: env.AI_INTERPRETER_TIMEOUT_MS,
    maxInputChars: env.AI_INTERPRETER_MAX_INPUT_CHARS,
    minConfidence: env.AI_INTERPRETER_MIN_CONFIDENCE,
  });
  return singleton;
}

export function resetMessageInterpreter(): void {
  singleton = null;
}
