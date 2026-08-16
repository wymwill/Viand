import Anthropic from "@anthropic-ai/sdk";
import type { Restaurant } from "@/domain/restaurants/provider";
import type { EvalGroup } from "../generate";

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
 * Requires ANTHROPIC_API_KEY. Without one the runner skips it entirely and the
 * report says so, so `npm run eval` is useful with no credentials at all.
 */

export const MODEL_STRATEGY_ENV_KEY = "ANTHROPIC_API_KEY";

export interface ModelStrategyOptions {
  model: string;
  timeoutMs: number;
  /** How many groups may be in flight at once. */
  concurrency: number;
}

export const DEFAULT_MODEL_OPTIONS: ModelStrategyOptions = {
  model: "claude-haiku-4-5",
  timeoutMs: 20_000,
  concurrency: 4,
};

export function modelStrategyAvailable(): boolean {
  return Boolean(process.env[MODEL_STRATEGY_ENV_KEY]);
}

const SYSTEM_PROMPT = [
  "You are helping a group of friends choose one restaurant where everyone will eat together.",
  "You will be given what each person said, and a numbered list of restaurants.",
  "Choose the single best restaurant for the group based on what they said.",
  "Return its number in the required structured response.",
].join("\n");

const CHOICE_JSON_SCHEMA = {
  type: "object",
  properties: {
    restaurantIndex: { type: "integer" },
  },
  required: ["restaurantIndex"],
  additionalProperties: false,
} as const;

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
    const rating = restaurant.rating > 0 ? `, rated ${restaurant.rating}` : "";
    lines.push(
      `${index + 1}. ${restaurant.name} — ${restaurant.cuisine}, ` +
        `${"$".repeat(restaurant.priceLevel)}, ${restaurant.distanceMiles} mi${rating}${diets}`,
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

async function chooseOne(
  client: Anthropic,
  options: ModelStrategyOptions,
  group: EvalGroup,
  catalogue: readonly Restaurant[],
): Promise<Restaurant | null> {
  const response = await client.messages.create(
    {
      model: options.model,
      max_tokens: 64,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(group, catalogue) }],
      output_config: {
        format: {
          type: "json_schema",
          schema: CHOICE_JSON_SCHEMA,
        },
      },
    },
    { timeout: options.timeoutMs, maxRetries: 0 },
  );

  if (response.stop_reason === "max_tokens") return null;
  const block = response.content.find((entry) => entry.type === "text");
  if (!block) return null;

  const index = parseChoice(block.text, catalogue.length);
  return index == null ? null : (catalogue[index] ?? null);
}

export interface ModelRunResult {
  choices: Array<Restaurant | null>;
  errors: number;
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
  client: Anthropic = new Anthropic({ apiKey: process.env[MODEL_STRATEGY_ENV_KEY] as string }),
): Promise<ModelRunResult> {
  const choices: Array<Restaurant | null> = new Array(groups.length).fill(null);
  let errors = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= groups.length) return;

      const group = groups[index];
      if (!group) return;

      try {
        choices[index] = await chooseOne(client, options, group, catalogue);
        if (choices[index] == null) errors += 1;
      } catch {
        errors += 1;
        choices[index] = null;
      }
    }
  }

  const workerCount = Math.min(Math.max(1, options.concurrency), groups.length);
  const workers = Array.from({ length: workerCount }, worker);
  await Promise.all(workers);

  return { choices, errors };
}
