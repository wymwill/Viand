import { createHash } from "node:crypto";

/**
 * Structured logging for the paths that degrade.
 *
 * Every fallback in this codebase is deliberate and, until now, invisible: four
 * bare `console.warn` calls with no shape, so "how often did the restaurant
 * search fail last week, and why" could not be answered at all. Two production
 * incidents were diagnosed by reading raw request logs and re-deriving state by
 * hand; both would have been a single query against these.
 *
 * The rule that shapes this: a log line may say what happened and to which
 * conversation, never what anybody wrote or who they are. Message text and
 * member handles are the two things most useful for debugging and the two least
 * defensible to retain, so neither is accepted here — `chat` is a short digest
 * that correlates lines within one conversation without naming it.
 */

/**
 * Stable reason codes. These are the query keys, so they are treated as an API:
 * rename one and every saved search against it silently returns nothing.
 */
export type LogEvent =
  | "restaurant_search_failed"
  | "restaurant_served_stale"
  | "restaurant_cache_unavailable"
  | "restaurant_source_failover"
  | "interpreter_fell_back"
  | "cuisine_mediation_skipped"
  | "cuisine_mediation_failed"
  | "reply_delivery_failed"
  | "interaction_failed";

export interface LogFields {
  /** Correlates lines within one conversation without identifying it. */
  chat?: string;
  /** Transport the line came from, when it is transport specific. */
  transport?: string;
  /** Short machine-readable cause, e.g. "HTTP 504" or "TimeoutError". */
  cause?: string;
  /** Whatever count makes the line actionable — attempts, age, remaining. */
  [key: string]: string | number | boolean | undefined;
}

/**
 * A stable, non-reversible reference to a chat. Enough to group lines from one
 * conversation while debugging; not enough to identify the chat or its members.
 */
export function chatRef(chatId: string): string {
  return createHash("sha256").update(chatId).digest("hex").slice(0, 8);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "Error" ? error.message : `${error.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * Records a degradation. Always a warning: these are paths the product handles
 * on purpose, so they are not errors, but every one of them means a group got
 * something less than the best answer.
 */
export function logDegradation(event: LogEvent, fields: LogFields = {}, error?: unknown): void {
  const line: Record<string, unknown> = { event, ...fields };
  if (error !== undefined) line.cause = fields.cause ?? describe(error);
  for (const key of Object.keys(line)) {
    if (line[key] === undefined) delete line[key];
  }
  console.warn(JSON.stringify(line));
}
