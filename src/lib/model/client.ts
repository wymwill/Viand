import Anthropic from "@anthropic-ai/sdk";

/**
 * Talking to a model, wherever it lives.
 *
 * Three callers share this: the eval harness scoring an unstructured baseline,
 * the message interpreter, and the cuisine mediator. They differ only in the
 * prompt and the schema, so the transport is worth having once — and it means a
 * provider swap is configuration rather than three edits.
 */

/**
 * The outcome of one call, split by *who* is responsible.
 *
 * This distinction is load-bearing. `abstained` is a fact about the model: it
 * answered, and the answer was unusable. `unavailable` is a fact about the
 * transport: quota, a 5xx, a timeout. Collapsing the two — as returning a bare
 * null does — lets a rate-limited run masquerade as a model that declines to
 * answer, which would silently corrupt the only number this harness exists to
 * produce. A run with any `unavailable` result is not publishable, and the
 * report has to be able to say so.
 */
export type CompletionResult =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "abstained"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * The transport seam for strategy (b).
 *
 * Only the network call varies by provider. The prompt, the JSON schema, and
 * the parser are shared, because the strategy is a claim about *structure* —
 * that an unscaffolded prompt handles hard constraints worse than an explicit
 * eligibility filter does. If each provider got its own prompt or its own
 * lenient parser, the comparison would be measuring prompt engineering instead.
 */
export interface ModelClient {
  /** Names the provider and model in the report, so a run is attributable. */
  readonly label: string;
  /**
   * `schema` is JSON Schema. Providers want it in their own dialect, so each
   * client translates; callers state the shape once and stay portable.
   */
  complete(
    system: string,
    prompt: string,
    timeoutMs: number,
    schema?: Record<string, unknown>,
  ): Promise<CompletionResult>;
}

export const ANTHROPIC_ENV_KEY = "ANTHROPIC_API_KEY";
export const GEMINI_ENV_KEY = "GEMINI_API_KEY";
export const OPENROUTER_ENV_KEY = "OPENROUTER_API_KEY";

/**
 * The schema both providers are held to. One integer, nothing else — an
 * unparseable or out-of-range answer is an abstention, not a retry.
 */
const CHOICE_PROPERTY = "restaurantIndex";

const ANTHROPIC_SCHEMA = {
  type: "object",
  properties: { [CHOICE_PROPERTY]: { type: "integer" } },
  required: [CHOICE_PROPERTY],
  additionalProperties: false,
} as const;

/**
 * Gemini takes an OpenAPI subset rather than JSON Schema: uppercase type
 * names, and no `additionalProperties`. The shape is otherwise the same.
 */
const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: { [CHOICE_PROPERTY]: { type: "INTEGER" } },
  required: [CHOICE_PROPERTY],
} as const;

export function createAnthropicClient(model: string, apiKey: string): ModelClient {
  const client = new Anthropic({ apiKey });

  return {
    label: `anthropic/${model}`,
    async complete(system, prompt, timeoutMs, schema) {
      let response;
      try {
        response = await client.messages.create(
          {
            model,
            max_tokens: 256,
            temperature: 0,
            system,
            messages: [{ role: "user", content: prompt }],
            output_config: {
              format: { type: "json_schema", schema: schema ?? ANTHROPIC_SCHEMA },
            },
          },
          { timeout: timeoutMs, maxRetries: MAX_ATTEMPTS - 1 },
        );
      } catch (error) {
        return { kind: "unavailable", reason: describeError(error) };
      }

      if (response.stop_reason === "max_tokens") {
        return { kind: "abstained", reason: "truncated at max_tokens" };
      }
      const block = response.content.find((entry) => entry.type === "text");
      if (!block) return { kind: "abstained", reason: "no text block in response" };
      return { kind: "text", text: block.text };
    },
  };
}

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Attempts per call, including the first.
 *
 * The production request path sets retries to zero on purpose: a user waiting
 * on a reply is better served by a fast fallback than a slow correct answer.
 * An offline batch harness has the opposite trade-off — nobody is waiting, and
 * a dropped call biases a published number. Free-tier Gemini rejects a handful
 * of requests per minute, which is below what this harness emits even at low
 * concurrency, so retrying rate-limit rejections is what makes a run complete
 * rather than an optimisation.
 */
const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 3_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uses the REST API over global `fetch` rather than a client library. The call
 * is one POST with a JSON body; a dependency would earn nothing here, and the
 * eval harness is the last place that should grow one.
 */
/**
 * Gemini takes an OpenAPI subset: uppercase type names, and no
 * `additionalProperties`. Translating keeps callers on one dialect.
 */
function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;
    if (key === "type" && typeof value === "string") {
      converted[key] = value.toUpperCase();
    } else if (key === "properties" && value && typeof value === "object") {
      converted[key] = Object.fromEntries(
        Object.entries(value as Record<string, Record<string, unknown>>).map(([name, property]) => [
          name,
          toGeminiSchema(property),
        ]),
      );
    } else {
      converted[key] = value;
    }
  }
  return converted;
}

export function createGeminiClient(
  model: string,
  apiKey: string,
  // Injectable so the retry tests do not spend the real backoff. The harness
  // itself always uses the default.
  baseBackoffMs: number = BASE_BACKOFF_MS,
): ModelClient {
  return {
    label: `google/${model}`,
    async complete(system, prompt, timeoutMs, schema) {
      const payload = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 256,
          responseMimeType: "application/json",
          responseSchema: GEMINI_SCHEMA,
          // Gemini 2.5 bills reasoning against maxOutputTokens, so a thinking
          // budget would let the model exhaust the cap before emitting any
          // text. Zero also keeps this comparable to the single unscaffolded
          // call the strategy is supposed to represent.
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      let lastReason = "no attempt made";

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await sleep(baseBackoffMs * 2 ** (attempt - 1));

        let response: Response;
        try {
          response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
            body: payload,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          lastReason = describeError(error);
          continue;
        }

        // 429 is quota and 5xx is the provider's problem; both are worth another
        // attempt. A 4xx is our malformed request and will fail identically.
        if (response.status === 429 || response.status >= 500) {
          lastReason = `HTTP ${response.status}`;
          continue;
        }
        if (!response.ok) {
          return { kind: "unavailable", reason: `HTTP ${response.status}` };
        }

        const body = (await response.json()) as GeminiResponse;
        const candidate = body.candidates?.[0];
        if (!candidate) return { kind: "abstained", reason: "no candidate returned" };
        if (candidate.finishReason === "MAX_TOKENS") {
          return { kind: "abstained", reason: "truncated at MAX_TOKENS" };
        }
        const text = candidate.content?.parts?.[0]?.text;
        if (text == null) return { kind: "abstained", reason: "candidate carried no text" };
        return { kind: "text", text };
      }

      return { kind: "unavailable", reason: `${lastReason} after ${MAX_ATTEMPTS} attempts` };
    },
  };
}

/**
 * OpenRouter speaks OpenAI's protocol and fronts many vendors, so one
 * credential covers Claude, Gemini, GPT and the open models — which is the
 * whole reason to prefer it: model choice becomes a config value instead of a
 * code change and a second billing relationship.
 *
 * Structured output goes through OpenAI's `response_format` rather than
 * Anthropic's `output_config`, and support varies by model. That is survivable
 * because every caller here already treats an unusable answer as an abstention
 * and falls back, but it is a reason to pick a model that honours schemas.
 */
/**
 * `maxAttempts` is the caller's call, because the trade differs by caller. An
 * offline benchmark should wait out a rate limit — nobody is watching, and a
 * dropped call biases a published number. A group chat is watching: retrying
 * there multiplies the wall clock people are staring at, and a deterministic
 * fallback is already sitting right there, so live callers pass 1.
 */
export function createOpenRouterClient(
  model: string,
  apiKey: string,
  options: { maxAttempts?: number; baseBackoffMs?: number } = {},
): ModelClient {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const baseBackoffMs = options.baseBackoffMs ?? BASE_BACKOFF_MS;
  return {
    label: `openrouter/${model}`,
    async complete(system, prompt, timeoutMs, schema) {
      const payload = JSON.stringify({
        model,
        max_tokens: 256,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          // ANTHROPIC_SCHEMA is plain JSON Schema, which is exactly what
          // OpenAI's protocol wants; no translation needed here.
          json_schema: { name: "answer", strict: true, schema: schema ?? ANTHROPIC_SCHEMA },
        },
      });

      let lastReason = "no attempt made";

      // Rate limits here are tight enough that two calls in flight trip them
      // immediately, so retrying is what makes a run complete at all rather
      // than an optimisation.
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0) await sleep(baseBackoffMs * 2 ** (attempt - 1));

        let response: Response;
        try {
          response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              // OpenRouter attributes traffic with these; neither is required.
              "HTTP-Referer": "https://github.com/wymwill/Viand",
              "X-Title": "Viand",
            },
            body: payload,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          lastReason = describeError(error);
          continue;
        }

        if (response.status === 429 || response.status >= 500) {
          lastReason = `HTTP ${response.status}`;
          continue;
        }
        if (!response.ok) return { kind: "unavailable", reason: `HTTP ${response.status}` };

        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
          choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
        } | null;

        // OpenRouter reports upstream failures in the body with a 200 status,
        // so the status alone says nothing about whether a model answered.
        if (body?.error) {
          return { kind: "unavailable", reason: body.error.message ?? "upstream error" };
        }

        const choice = body?.choices?.[0];
        if (!choice) return { kind: "abstained", reason: "no choice returned" };
        if (choice.finish_reason === "length") {
          return { kind: "abstained", reason: "truncated at max_tokens" };
        }
        const text = choice.message?.content;
        if (!text) return { kind: "abstained", reason: "choice carried no content" };
        return { kind: "text", text };
      }

      return { kind: "unavailable", reason: `${lastReason} after ${maxAttempts} attempts` };
    },
  };
}

/** Default model per provider, overridable with `--model`. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-haiku-4.5";

/**
 * Picks a provider from whichever credential is present, preferring Gemini.
 *
 * Grading the shipped scorer against a *different vendor's* model is the
 * stronger claim: beating one's own house model invites the objection that the
 * baseline was chosen to lose.
 */
export function resolveModelClient(modelOverride?: string): ModelClient | null {
  // OpenRouter first: one credential covers every vendor, so if it is present
  // it is almost certainly the one intended.
  const openRouterKey = process.env[OPENROUTER_ENV_KEY];
  if (openRouterKey) {
    return createOpenRouterClient(modelOverride ?? DEFAULT_OPENROUTER_MODEL, openRouterKey);
  }

  const geminiKey = process.env[GEMINI_ENV_KEY];
  if (geminiKey) return createGeminiClient(modelOverride ?? DEFAULT_GEMINI_MODEL, geminiKey);

  const anthropicKey = process.env[ANTHROPIC_ENV_KEY];
  if (anthropicKey) {
    return createAnthropicClient(modelOverride ?? DEFAULT_ANTHROPIC_MODEL, anthropicKey);
  }

  return null;
}
