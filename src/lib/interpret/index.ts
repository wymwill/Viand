import { DeterministicInterpreter } from "@/domain/interpret/deterministic";
import type { MessageInterpreter } from "@/domain/interpret/types";
import { getEnv } from "../env";
import {
  createAnthropicClient,
  createOpenRouterClient,
  type ModelClient,
} from "../model/client";
import type { SessionStore } from "../store/types";
import { SessionStoreCallBudget } from "./call-budget";
import { ClaudeInterpreter } from "./claude-interpreter";
import { ModelCuisineMediator } from "./cuisine-mediator";
import type { CuisineMediator } from "@/domain/recommendations/mediation";

let singleton: MessageInterpreter | null = null;

/**
 * Whichever provider is configured, OpenRouter first: one credential covers
 * every vendor, so its presence is a clear statement of intent. Null means no
 * model is available and every model-backed feature stays dormant.
 */
function modelClient(env: ReturnType<typeof getEnv>): ModelClient | null {
  if (env.OPENROUTER_API_KEY) {
    // One attempt: a group is waiting, and the rules parser answers instantly.
    return createOpenRouterClient(env.OPENROUTER_MODEL, env.OPENROUTER_API_KEY, {
      maxAttempts: 1,
    });
  }
  if (env.ANTHROPIC_API_KEY) {
    return createAnthropicClient(env.AI_INTERPRETER_MODEL, env.ANTHROPIC_API_KEY);
  }
  return null;
}

/**
 * The interpreter the live webhook path should use. Held as a singleton so the
 * Anthropic client's connection pool is reused across requests.
 */
export function getMessageInterpreter(store: SessionStore): MessageInterpreter {
  if (singleton) return singleton;

  const env = getEnv();
  const client = modelClient(env);
  if (!env.USE_AI_INTERPRETER || !client) {
    singleton = new DeterministicInterpreter();
    return singleton;
  }

  singleton = new ClaudeInterpreter({
    client,
    model: env.AI_INTERPRETER_MODEL,
    timeoutMs: env.AI_INTERPRETER_TIMEOUT_MS,
    maxInputChars: env.AI_INTERPRETER_MAX_INPUT_CHARS,
    minConfidence: env.AI_INTERPRETER_MIN_CONFIDENCE,
    // The store, not a local map: on serverless the instances share no memory,
    // so a per-process counter would bound nothing.
    budget: new SessionStoreCallBudget(store, {
      perChatMax: env.AI_INTERPRETER_MAX_CALLS_PER_CHAT,
      perChatWindowSeconds: env.AI_INTERPRETER_CHAT_WINDOW_SECONDS,
      dailyMax: env.AI_INTERPRETER_MAX_CALLS_PER_DAY,
    }),
  });
  return singleton;
}

/**
 * The mediator, when one is configured. Null keeps a split group on exactly the
 * behaviour it had before this existed, which is the only acceptable default:
 * an unavailable model must cost coverage, never an answer.
 */
export function getCuisineMediator(store: SessionStore, chatId?: string): CuisineMediator | null {
  const env = getEnv();
  const client = modelClient(env);
  if (!env.USE_AI_INTERPRETER || !client) return null;

  return new ModelCuisineMediator({
    client,
    model: env.AI_INTERPRETER_MODEL,
    timeoutMs: env.AI_INTERPRETER_TIMEOUT_MS,
    budget: new SessionStoreCallBudget(store, {
      perChatMax: env.AI_INTERPRETER_MAX_CALLS_PER_CHAT,
      perChatWindowSeconds: env.AI_INTERPRETER_CHAT_WINDOW_SECONDS,
      dailyMax: env.AI_INTERPRETER_MAX_CALLS_PER_DAY,
    }),
    chatId,
  });
}

export function resetMessageInterpreter(): void {
  singleton = null;
}
