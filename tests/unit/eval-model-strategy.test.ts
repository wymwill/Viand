import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Restaurant } from "@/domain/restaurants/provider";
import { emptyPreference, type Cuisine } from "@/domain/types";
import type { EvalGroup, EvalMember, LatentMember } from "../../scripts/eval/generate";
import {
  runModelStrategy,
  type ModelStrategyOptions,
} from "../../scripts/eval/strategies/model";

const OPTIONS: ModelStrategyOptions = {
  model: "claude-haiku-4-5",
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

type CreateCall = { params: unknown; requestOptions: unknown };

function stubClient(
  handler: (callIndex: number) => unknown | Promise<unknown>,
  stopReason: string | null = "end_turn",
) {
  const calls: CreateCall[] = [];
  const client = {
    messages: {
      create: async (params: unknown, requestOptions: unknown) => {
        calls.push({ params, requestOptions });
        const payload = await handler(calls.length - 1);
        const text = typeof payload === "string" ? payload : JSON.stringify(payload);
        return { content: [{ type: "text", text }], stop_reason: stopReason };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe("model eval strategy", () => {
  it("maps a valid structured 1-based index to the catalogue", async () => {
    const { client } = stubClient(() => ({ restaurantIndex: 2 }));

    const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

    expect(result).toEqual({ choices: [catalogue[1]], errors: 0 });
  });

  it("counts an out-of-range index as an error and abstains", async () => {
    const { client } = stubClient(() => ({ restaurantIndex: 99 }));

    const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

    expect(result).toEqual({ choices: [null], errors: 1 });
  });

  it.each(["", "pick the Korean place", "{restaurantIndex: 2}", '{"restaurantIndex":"2"}']) (
    "counts malformed response %j as an error and abstains",
    async (response) => {
      const { client } = stubClient(() => response);
      const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

      expect(result).toEqual({ choices: [null], errors: 1 });
    },
  );

  it("catches a rejected request and preserves timeout and retry options", async () => {
    const { client, calls } = stubClient(() => {
      throw new Error("network timeout");
    });

    await expect(runModelStrategy([group()], catalogue, OPTIONS, client)).resolves.toEqual({
      choices: [null],
      errors: 1,
    });
    expect(calls[0]?.requestOptions).toEqual({ timeout: 321, maxRetries: 0 });
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

    const params = calls[0]?.params as {
      system: string;
      messages: Array<{ content: string }>;
      output_config: { format: { type: string; schema: unknown } };
    };
    const prompt = params.messages[0]?.content ?? "";
    expect(params.system).toContain("everyone will eat together");
    expect(prompt).toContain("Korean sounds great, but I need halal food.");
    expect(prompt).toContain("Keep it under $$$ and within 3 miles.");
    expect(prompt).toContain("1. Nearby Pizza — pizza, $$, 0.5 mi, rated 4.2, accommodates vegetarian");
    expect(prompt).toContain(
      "2. Halal Korean Table — korean, $$$, 2.25 mi, rated 4.8, accommodates halal/gluten_free",
    );
    expect(prompt).toContain("3. Far Cafe — cafe, $, 7 mi");
    expect(params.output_config.format.type).toBe("json_schema");
  });

  it("treats a max-token response as a truncated failure even if its JSON parses", async () => {
    const { client } = stubClient(() => ({ restaurantIndex: 1 }), "max_tokens");

    const result = await runModelStrategy([group()], catalogue, OPTIONS, client);

    expect(result).toEqual({ choices: [null], errors: 1 });
  });
});
