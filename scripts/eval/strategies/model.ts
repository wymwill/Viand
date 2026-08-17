import type { Restaurant } from "@/domain/restaurants/provider";
import type { EvalGroup } from "../generate";
import { type ModelClient, resolveModelClient } from "./model-client";

/**
 * Strategy (b): a single unstructured prompt.
 *
 * The point of comparison is *structure*, not intelligence. This strategy gets
 * the same information as the others, but as prose rather than parsed fields,
 * and is asked to return one index with no scaffolding — no eligibility
 * filter, no fairness objective, nothing that makes a hard constraint
 * categorically different from a preference. Whether that matters is the
 * question the harness answers.
 *
 * Requires GEMINI_API_KEY or ANTHROPIC_API_KEY. Without either, the runner
 * skips it entirely and the report says so, so `npm run eval` is useful with no
 * credentials at all. Which provider answered is recorded in the report label,
 * because a fairness number is not comparable across models.
 */

export interface ModelStrategyOptions {
  timeoutMs: number;
  /** How many groups may be in flight at once. */
  concurrency: number;
}

export const DEFAULT_MODEL_OPTIONS: ModelStrategyOptions = {
  timeoutMs: 20_000,
  // Low enough to stay inside a free-tier per-minute quota. The harness is not
  // latency-sensitive, and a run that finishes slowly beats one whose rejected
  // calls quietly bias the result.
  concurrency: 2,
};

export function modelStrategyAvailable(): boolean {
  return resolveModelClient() != null;
}

const SYSTEM_PROMPT = [
  "You are helping a group of friends choose one restaurant where everyone will eat together.",
  "You will be given what each person said, and a numbered list of restaurants.",
  "Choose the single best restaurant for the group based on what they said.",
  "Return its number in the required structured response.",
].join("\n");

function buildPrompt(group: EvalGroup, catalogue: readonly Restaurant[]): string {
  const lines: string[] = ["What each person said:", ""];

  group.members.forEach((member, index) => {
    lines.push(`Person ${index + 1}: ${member.sentence}`);
  });

  lines.push("", "Restaurants:", "");
  catalogue.forEach((restaurant, index) => {
    const diets =
      restaurant.accommodates.length > 0
        ? `, accommodates ${restaurant.accommodates.join("/")}`
        : "";
    const rating = restaurant.rating != null ? `, rated ${restaurant.rating}` : "";
    const price = restaurant.priceLevel == null ? "price unknown" : "$".repeat(restaurant.priceLevel);
    lines.push(
      `${index + 1}. ${restaurant.name} — ${restaurant.cuisine}, ` +
        `${price}, ${restaurant.distanceMiles} mi${rating}${diets}`,
    );
  });

  lines.push("", `Choose one restaurant numbered from 1 to ${catalogue.length}.`);
  return lines.join("\n");
}

function parseChoice(text: string, max: number): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "restaurantIndex") return null;
  const index = (parsed as { restaurantIndex?: unknown }).restaurantIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > max) return null;
  return index - 1;
}

type ChoiceOutcome =
  | { kind: "chosen"; restaurant: Restaurant }
  | { kind: "abstained" }
  | { kind: "unavailable" };

async function chooseOne(
  client: ModelClient,
  options: ModelStrategyOptions,
  group: EvalGroup,
  catalogue: readonly Restaurant[],
): Promise<ChoiceOutcome> {
  const result = await client.complete(
    SYSTEM_PROMPT,
    buildPrompt(group, catalogue),
    options.timeoutMs,
  );
  if (result.kind === "unavailable") return { kind: "unavailable" };
  if (result.kind === "abstained") return { kind: "abstained" };

  const index = parseChoice(result.text, catalogue.length);
  if (index == null) return { kind: "abstained" };
  const restaurant = catalogue[index];
  return restaurant ? { kind: "chosen", restaurant } : { kind: "abstained" };
}

export interface ModelRunResult {
  choices: Array<Restaurant | null>;
  /** Calls the model answered unusably — its own doing, and a real result. */
  errors: number;
  /**
   * Calls the transport never delivered — quota, 5xx, timeout. Not the model's
   * doing, and not a result. Any non-zero value makes the run unpublishable.
   */
  unavailable: number;
  /** Which provider and model produced these choices, for the report. */
  label: string;
}

/**
 * Runs the model strategy across every group with bounded concurrency. A
 * failure — timeout, malformed reply, out-of-range index — is counted and
 * recorded as an abstention rather than thrown, so one bad call cannot lose
 * the whole run.
 */
export async function runModelStrategy(
  groups: readonly EvalGroup[],
  catalogue: readonly Restaurant[],
  options: ModelStrategyOptions = DEFAULT_MODEL_OPTIONS,
  client: ModelClient | null = resolveModelClient(),
): Promise<ModelRunResult> {
  if (!client) throw new Error("runModelStrategy needs a credential; check modelStrategyAvailable");
  // Bound to a const so the narrowing survives into the worker closure.
  const resolved = client;

  const choices: Array<Restaurant | null> = new Array(groups.length).fill(null);
  let errors = 0;
  let unavailable = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= groups.length) return;

      const group = groups[index];
      if (!group) return;

      try {
        const outcome = await chooseOne(resolved, options, group, catalogue);
        choices[index] = outcome.kind === "chosen" ? outcome.restaurant : null;
        if (outcome.kind === "abstained") errors += 1;
        if (outcome.kind === "unavailable") unavailable += 1;
      } catch {
        // A throw escaping a client is itself a transport failure, not an answer.
        unavailable += 1;
        choices[index] = null;
      }
    }
  }

  const workerCount = Math.min(Math.max(1, options.concurrency), groups.length);
  const workers = Array.from({ length: workerCount }, worker);
  await Promise.all(workers);

  return { choices, errors, unavailable, label: resolved.label };
}
