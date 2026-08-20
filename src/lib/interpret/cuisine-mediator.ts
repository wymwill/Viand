import type {
  CuisineMediationRequest,
  CuisineMediator,
} from "@/domain/recommendations/mediation";
import { CUISINES, type Cuisine } from "@/domain/types";
import type { ModelClient } from "../model/client";
import { chatRef, logDegradation } from "../observability/log";
import type { InterpreterBudget } from "./call-budget";

/**
 * Asks a model which single cuisine two camps might both accept.
 *
 * This is the one judgement in the product a model is genuinely better at than
 * the code: whether Korean and Italian meet somewhere is knowledge about food,
 * and `CUISINE_FAMILIES` is a hand-written table that only knows the bridges
 * somebody thought to write down.
 *
 * What it is not allowed to do is decide anything. It returns a cuisine, the
 * group votes on it, and the deterministic scorer then does exactly what it
 * always did. A model that is unavailable, over budget, slow, or that answers
 * with something not on the menu returns null, and the group sees precisely
 * what it would have seen without any of this.
 */

export interface CuisineMediatorOptions {
  readonly client: ModelClient;
  readonly model: string;
  readonly timeoutMs: number;
  readonly budget?: InterpreterBudget;
  readonly chatId?: string;
}

const SYSTEM_PROMPT = [
  "A group cannot agree on what to eat. Each person named a different cuisine.",
  "Pick one cuisine from the available list that both camps would plausibly accept.",
  "Prefer something that genuinely bridges what they asked for, not simply the most popular option.",
  "If nothing on the list is a reasonable compromise, say so rather than forcing one.",
].join("\n");

const CHOICE_SCHEMA = {
  type: "object",
  properties: {
    cuisine: { type: "string" },
    /** Lets the model decline, which is a better answer than a bad bridge. */
    noReasonableCompromise: { type: "boolean" },
  },
  required: ["cuisine", "noReasonableCompromise"],
  additionalProperties: false,
} as const;

function isCuisine(value: string): value is Cuisine {
  return (CUISINES as readonly string[]).includes(value);
}

export class ModelCuisineMediator implements CuisineMediator {
  constructor(private readonly options: CuisineMediatorOptions) {}

  async propose(request: CuisineMediationRequest): Promise<Cuisine | null> {
    const chat = this.options.chatId ? chatRef(this.options.chatId) : undefined;

    if (this.options.budget) {
      const decision = await this.options.budget.check(this.options.chatId ?? "unknown");
      if (!decision.allowed) {
        logDegradation("cuisine_mediation_skipped", { chat, cause: decision.reason });
        return null;
      }
    }

    try {
      const result = await this.options.client.complete(
        SYSTEM_PROMPT,
        [
          `They asked for: ${request.wanted.join(", ")}.`,
          `Available nearby: ${request.available.join(", ")}.`,
        ].join("\n"),
        this.options.timeoutMs,
        CHOICE_SCHEMA as unknown as Record<string, unknown>,
      );
      if (result.kind !== "text") {
        logDegradation("cuisine_mediation_skipped", { chat, cause: result.reason });
        return null;
      }

      const parsed = JSON.parse(result.text) as {
        cuisine?: unknown;
        noReasonableCompromise?: unknown;
      };
      if (parsed.noReasonableCompromise === true) return null;
      if (typeof parsed.cuisine !== "string") return null;

      const cuisine = parsed.cuisine.trim().toLowerCase().replace(/[\s-]+/g, "_");
      // The engine checks availability too; this only keeps a value that is
      // not a cuisine at all from travelling any further.
      return isCuisine(cuisine) ? cuisine : null;
    } catch (error) {
      logDegradation("cuisine_mediation_failed", { chat }, error);
      return null;
    }
  }
}
