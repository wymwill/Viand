import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { parseCommand } from "@/domain/commands";
import type { InterpretInput } from "@/domain/interpret/types";
import type { DecisionState } from "@/domain/types";
import { ClaudeInterpreter } from "@/lib/interpret/claude-interpreter";

/**
 * The interpreter's contract is that it can never make the conversation worse:
 * an unavailable, slow, or wrong model must degrade to the deterministic parse
 * rather than change what the bot does.
 */

type ModelPreference = {
  preferredCuisines: string[];
  excludedCuisines: string[];
  dietary: string[];
  maxPriceLevel: number;
  maxDistanceMiles: number;
  noPreference: boolean;
  hasAllergyConcern: boolean;
};

function modelOutput(overrides: Record<string, unknown> = {}) {
  const preference: ModelPreference = {
    preferredCuisines: [],
    excludedCuisines: [],
    dietary: [],
    maxPriceLevel: 0,
    maxDistanceMiles: 0,
    noPreference: false,
    hasAllergyConcern: false,
  };
  return { intent: "CHATTER", option: 0, preference, confidence: 0.9, ...overrides };
}

/** Returns a client whose single call is driven by `handler`, plus a call count. */
function stubClient(handler: () => unknown) {
  const calls = { count: 0 };
  const client = {
    messages: {
      create: async () => {
        calls.count += 1;
        const payload = handler();
        const text = typeof payload === "string" ? payload : JSON.stringify(payload);
        return { content: [{ type: "text", text }] };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

function interpreter(client: Anthropic, overrides: Record<string, unknown> = {}) {
  return new ClaudeInterpreter({
    client,
    model: "claude-haiku-4-5",
    timeoutMs: 1_000,
    maxInputChars: 500,
    minConfidence: 0.6,
    onError: () => {},
    ...overrides,
  });
}

function input(
  text: string,
  state: DecisionState = "COLLECTING_PREFERENCES",
  optionNames?: string[],
): InterpretInput {
  return { text, command: parseCommand(text), state, optionNames };
}

describe("ClaudeInterpreter", () => {
  it("never consults the model for a command the parser already recognised", async () => {
    const { client, calls } = stubClient(() => modelOutput());

    for (const text of ["1", "veto 2", "done", "cancel", "help", "STOP"]) {
      const result = await interpreter(client).interpret(input(text, "VOTING"));
      expect(result.source).toBe("rules");
    }
    expect(calls.count).toBe(0);
  });

  it("skips the model for a message longer than the input cap", async () => {
    const { client, calls } = stubClient(() => modelOutput());
    const result = await interpreter(client, { maxInputChars: 20 }).interpret(
      input("a".repeat(400)),
    );

    expect(result.source).toBe("rules");
    expect(calls.count).toBe(0);
  });

  it("falls back to the rules parser when the call fails", async () => {
    const errors: unknown[] = [];
    const { client } = stubClient(() => {
      throw new Error("timed out");
    });

    const result = await interpreter(client, {
      onError: (error: unknown) => errors.push(error),
    }).interpret(input("Mexican or Korean, under $25"));

    expect(result.source).toBe("rules");
    // The rules parser still did its job, so the turn is not degraded.
    expect(result.preference?.preferredCuisines).toContain("mexican");
    expect(errors).toHaveLength(1);
  });

  it("falls back when the response is not valid JSON", async () => {
    const { client } = stubClient(() => "sorry, I can't do that");
    const result = await interpreter(client).interpret(input("pizza please"));

    expect(result.source).toBe("rules");
    expect(result.preference?.preferredCuisines).toContain("pizza");
  });

  it("falls back when the response does not match the schema", async () => {
    const { client } = stubClient(() => ({ intent: "ORDER_FOOD", confidence: 1 }));
    const result = await interpreter(client).interpret(input("pizza please"));

    expect(result.source).toBe("rules");
  });

  it("falls back when the model is not confident enough", async () => {
    const { client } = stubClient(() =>
      modelOutput({ intent: "CANCEL", confidence: 0.2 }),
    );
    const result = await interpreter(client).interpret(input("eh forget it maybe"));

    expect(result.source).toBe("rules");
    expect(result.command.kind).toBe("FREEFORM");
  });

  it("resolves a natural-language vote while voting", async () => {
    const { client } = stubClient(() => modelOutput({ intent: "VOTE", option: 2 }));
    const result = await interpreter(client).interpret(
      input("the taco place works for me", "VOTING", ["Sushi Ya", "Taqueria Uno", "Pizza Pi"]),
    );

    expect(result.source).toBe("ai");
    expect(result.command).toEqual({ kind: "VOTE", option: 2 });
  });

  it("refuses a vote when no options are on the table", async () => {
    const { client } = stubClient(() => modelOutput({ intent: "VOTE", option: 2 }));
    const result = await interpreter(client).interpret(
      input("the taco place works for me", "COLLECTING_PREFERENCES"),
    );

    expect(result.source).toBe("rules");
    expect(result.command.kind).toBe("FREEFORM");
  });

  it("maps an extracted preference into domain types", async () => {
    const { client } = stubClient(() =>
      modelOutput({
        intent: "PREFERENCE",
        confidence: 0.95,
        preference: {
          preferredCuisines: ["korean", "japanese"],
          excludedCuisines: ["seafood"],
          dietary: ["nut_free"],
          maxPriceLevel: 2,
          maxDistanceMiles: 3,
          noPreference: false,
          hasAllergyConcern: false,
        },
      }),
    );

    const result = await interpreter(client).interpret(
      input("korean or japanese, nothing with nuts, cheap, close by"),
    );

    expect(result.source).toBe("ai");
    expect(result.preference).toMatchObject({
      preferredCuisines: ["korean", "japanese"],
      excludedCuisines: ["seafood"],
      dietary: ["nut_free"],
      maxPriceLevel: 2,
      maxDistanceMiles: 3,
    });
    // A nut requirement is allergy-derived regardless of what the model said.
    expect(result.preference?.hasAllergyConcern).toBe(true);
    expect(result.preference?.originalMessage).toContain("korean or japanese");
  });

  it("backfills from the rules parser when the model extracts nothing", async () => {
    const { client } = stubClient(() => modelOutput({ intent: "PREFERENCE" }));
    const result = await interpreter(client).interpret(input("vegetarian, under $20"));

    expect(result.source).toBe("ai");
    expect(result.preference?.dietary).toContain("vegetarian");
    expect(result.preference?.maxPriceLevel).toBe(2);
  });
});
