import { afterEach, describe, expect, it } from "vitest";
import type { Restaurant } from "@/domain/restaurants/provider";
import { emptyPreference, type Cuisine } from "@/domain/types";
import type { EvalGroup, EvalMember, LatentMember } from "../../scripts/eval/generate";
import {
  runModelStrategy,
  type ModelStrategyOptions,
} from "../../scripts/eval/strategies/model";
import { createGeminiClient, type ModelClient } from "../../scripts/eval/strategies/model-client";

const OPTIONS: ModelStrategyOptions = {
  timeoutMs: 321,
  concurrency: 2,
};

const catalogue: Restaurant[] = [
  {
    id: "nearby-pizza",
    name: "Nearby Pizza",
    chainId: null,
    address: "1 Main St",
    cuisine: "pizza",
    priceLevel: 2,
    rating: 4.2,
    distanceMiles: 0.5,
    mapsUrl: "https://example.test/pizza",
    accommodates: ["vegetarian"],
    openNow: true,
    openingHoursRaw: null,
  },
  {
    id: "halal-korean",
    name: "Halal Korean Table",
    chainId: null,
    address: "2 Main St",
    cuisine: "korean",
    priceLevel: 3,
    rating: 4.8,
    distanceMiles: 2.25,
    mapsUrl: "https://example.test/korean",
    accommodates: ["halal", "gluten_free"],
    openNow: true,
    openingHoursRaw: null,
  },
  {
    id: "far-cafe",
    name: "Far Cafe",
    chainId: null,
    address: "3 Main St",
    cuisine: "cafe",
    priceLevel: 1,
    rating: 0,
    distanceMiles: 7,
    mapsUrl: "https://example.test/cafe",
    accommodates: [],
    openNow: true,
    openingHoursRaw: null,
  },
];

function member(id: string, sentence: string): EvalMember {
  const latent: LatentMember = {
    cuisineUtility: {} as Record<Cuisine, number>,
    idealPriceLevel: 2,
    pricePenalty: 0.2,
    distanceTolerance: 3,
    easygoing: false,
    hardConstraint: null,
  };
  const stated = emptyPreference(sentence);
  return { id, sentence, latent, stated };
}

function group(id = "group-1"): EvalGroup {
  return {
    id,
    members: [
      member(`${id}-a`, "Korean sounds great, but I need halal food."),
      member(`${id}-b`, "Keep it under $$$ and within 3 miles."),
    ],
  };
}

type CompleteCall = { system: string; prompt: string; timeoutMs: number };

/**
 * Stubs the transport seam rather than a vendor SDK, so these tests cover the
 * strategy — prompt construction, parsing, abstention, concurrency — for every
 * provider at once. Provider-specific wire handling is tested separately below.
 */
function stubClient(handler: (callIndex: number) => unknown | Promise<unknown>) {
  const calls: CompleteCall[] = [];
  const client: ModelClient = {
    label: "stub/test-model",
    complete: async (system, prompt, timeoutMs) => {
      calls.push({ system, prompt, timeoutMs });
      const payload = await handler(calls.length - 1);
      if (payload === null) return { kind: "abstained", reason: "stub abstained" };
      if (payload === UNAVAILABLE) return { kind: "unavailable", reason: "stub unavailable" };
      const text = typeof payload === "string" ? payload : JSON.stringify(payload);
      return { kind: "text", text };
    },
  };
  return { client, calls };
}

/** Sentinel letting a stub signal a transport failure rather than a bad answer. */
const UNAVAILABLE = Symbol("unavailable");

describe("model eval strategy", () => {
  it("maps a valid structured 1-based index to the catalogue", async () => {
    const { client } = stubClient(() => ({ restaurantIndex: 2 }));

    const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

    expect(result).toEqual({
      choices: [catalogue[1]],
      errors: 0,
      unavailable: 0,
      label: "stub/test-model",
    });
  });

  it("separates a transport failure from a bad answer", async () => {
    const { client } = stubClient(() => UNAVAILABLE);

    const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

    // The distinction the published number depends on: the model was never
    // asked, so this must not be recorded as the model answering badly.
    expect(result.choices).toEqual([null]);
    expect(result.unavailable).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("counts a throw escaping the client as a transport failure", async () => {
    const { client } = stubClient(() => {
      throw new Error("socket hang up");
    });

    const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

    expect(result.unavailable).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("counts an out-of-range index as an error and abstains", async () => {
    const { client } = stubClient(() => ({ restaurantIndex: 99 }));

    const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

    expect(result.choices).toEqual([null]);
    expect(result.errors).toBe(1);
  });

  it.each(["", "pick the Korean place", "{restaurantIndex: 2}", '{"restaurantIndex":"2"}']) (
    "counts malformed response %j as an error and abstains",
    async (response) => {
      const { client } = stubClient(() => response);
      const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

      expect(result.choices).toEqual([null]);
      expect(result.errors).toBe(1);
    },
  );

  it("treats a client-signalled failure as an abstention", async () => {
    const { client } = stubClient(() => null);

    const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

    expect(result.choices).toEqual([null]);
    expect(result.errors).toBe(1);
  });

  it("passes the configured timeout through to the client", async () => {
    const { client, calls } = stubClient(() => ({ restaurantIndex: 1 }));

    await runModelStrategy([group()], catalogue, OPTIONS, client);

    expect(calls[0]?.timeoutMs).toBe(321);
  });

  it("reports which provider and model answered", async () => {
    const { client } = stubClient(() => ({ restaurantIndex: 1 }));

    const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

    expect(result.label).toBe("stub/test-model");
  });

  it("calls and records every group exactly once with bounded concurrency", async () => {
    const groups = Array.from({ length: 7 }, (_, index) => group(`group-${index}`));
    let inFlight = 0;
    let peakInFlight = 0;
    const { client, calls } = stubClient(async (callIndex) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { restaurantIndex: (callIndex % catalogue.length) + 1 };
    });

    const result = await runModelStrategy(groups, catalogue, OPTIONS, client);

    expect(calls).toHaveLength(groups.length);
    expect(result.choices).toHaveLength(groups.length);
    expect(result.choices.every((choice) => choice != null)).toBe(true);
    expect(result.errors).toBe(0);
    expect(peakInFlight).toBeLessThanOrEqual(OPTIONS.concurrency);
  });

  it("sends every raw member sentence and decision-relevant catalogue detail", async () => {
    const { client, calls } = stubClient(() => ({ restaurantIndex: 2 }));
    await runModelStrategy([group()], catalogue, OPTIONS, client);

    const call = calls[0];
    const prompt = call?.prompt ?? "";
    expect(call?.system).toContain("everyone will eat together");
    expect(prompt).toContain("Korean sounds great, but I need halal food.");
    expect(prompt).toContain("Keep it under $$$ and within 3 miles.");
    expect(prompt).toContain("1. Nearby Pizza — pizza, $$, 0.5 mi, rated 4.2, accommodates vegetarian");
    expect(prompt).toContain(
      "2. Halal Korean Table — korean, $$$, 2.25 mi, rated 4.8, accommodates halal/gluten_free",
    );
    expect(prompt).toContain("3. Far Cafe — cafe, $, 7 mi");
  });
});

/**
 * The Gemini client is exercised against a stubbed `fetch`. What matters is
 * that every non-answer becomes a null — the strategy counts those as
 * abstentions, and a provider that leaked an exception or a partial string
 * would silently corrupt the comparison instead.
 */
describe("gemini model client", () => {
  const originalFetch = globalThis.fetch;

  function stubFetch(response: { ok?: boolean; status?: number; body?: unknown }) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: response.ok ?? true,
        status: response.status ?? (response.ok === false ? 500 : 200),
        json: async () => response.body ?? {},
      };
    }) as unknown as typeof fetch;
    return calls;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the structured text of the first candidate", async () => {
    stubFetch({
      body: {
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: '{"restaurantIndex":2}' }] } },
        ],
      },
    });

    const client = createGeminiClient("gemini-2.5-flash", "test-key", 0);

    await expect(client.complete("sys", "prompt", 100)).resolves.toEqual({
      kind: "text",
      text: '{"restaurantIndex":2}',
    });
  });

  it("abstains on a truncated response even when its JSON would parse", async () => {
    stubFetch({
      body: {
        candidates: [
          { finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"restaurantIndex":1}' }] } },
        ],
      },
    });

    const client = createGeminiClient("gemini-2.5-flash", "test-key", 0);
    const result = await client.complete("sys", "prompt", 100);

    // Truncation is the model's own doing, so it is an abstention, not a
    // transport failure — the run stays publishable.
    expect(result.kind).toBe("abstained");
  });

  it("abstains on an empty candidate list", async () => {
    stubFetch({ body: { candidates: [] } });

    const client = createGeminiClient("gemini-2.5-flash", "test-key", 0);
    const result = await client.complete("sys", "prompt", 100);

    expect(result.kind).toBe("abstained");
  });

  it("reports a client error status as unavailable without retrying", async () => {
    const calls = stubFetch({ ok: false, status: 400 });

    const client = createGeminiClient("gemini-2.5-flash", "test-key", 0);
    const result = await client.complete("sys", "prompt", 100);

    expect(result.kind).toBe("unavailable");
    // A 400 is our malformed request; retrying would fail identically.
    expect(calls).toHaveLength(1);
  });

  it("retries a rate-limit rejection and reports it as unavailable, never as an answer", async () => {
    const calls = stubFetch({ ok: false, status: 429 });

    const client = createGeminiClient("gemini-2.5-flash", "test-key", 0);
    const result = await client.complete("sys", "prompt", 100);

    // The distinction that keeps a quota-limited run from masquerading as a
    // model that declines to answer.
    expect(result.kind).toBe("unavailable");
    expect(calls.length).toBeGreaterThan(1);
  }, 30_000);

  it("succeeds on a retry after a transient rate limit", async () => {
    let attempt = 0;
    globalThis.fetch = (async () => {
      attempt += 1;
      if (attempt === 1) return { ok: false, status: 429, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }],
        }),
      };
    }) as unknown as typeof fetch;

    const client = createGeminiClient("gemini-2.5-flash", "test-key", 0);
    const result = await client.complete("sys", "prompt", 100);

    expect(result).toEqual({ kind: "text", text: "{}" });
    expect(attempt).toBe(2);
  }, 30_000);

  it("sends the key as a header and disables the thinking budget", async () => {
    const calls = stubFetch({
      body: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }] },
    });

    const client = createGeminiClient("gemini-2.5-flash", "test-key", 0);
    await client.complete("sys", "prompt", 100);

    const call = calls[0];
    expect(call?.url).toContain("gemini-2.5-flash:generateContent");
    // The key must never travel in the URL, where it would land in logs.
    expect(call?.url).not.toContain("test-key");
    expect((call?.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");

    const body = JSON.parse(String(call?.init.body)) as {
      generationConfig: { temperature: number; thinkingConfig: { thinkingBudget: number } };
    };
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });
});
