import { describe, expect, it } from "vitest";
import { parseCommand } from "@/domain/commands";
import type { InterpretInput } from "@/domain/interpret/types";
import type { DecisionState } from "@/domain/types";
import type { ModelClient } from "@/lib/model/client";
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

type RawResponse = { rawContent: unknown[] };

function rawResponse(rawContent: unknown[]): RawResponse {
  return { rawContent };
}

/**
 * Returns a client whose calls are driven by `handler`, plus captured
 * arguments. Stubs the shared model port rather than a vendor SDK, so these
 * tests hold for whichever provider is configured.
 */
function stubClient(handler: () => unknown | RawResponse) {
  const calls = {
    count: 0,
    requests: [] as unknown[],
    options: [] as unknown[],
  };
  const client: ModelClient = {
    label: "stub/test-model",
    complete: async (system, prompt, timeoutMs, schema) => {
      calls.count += 1;
      calls.requests.push({ system, messages: [{ content: prompt }], schema });
      calls.options.push({ timeout: timeoutMs });
      const payload = handler();
      if (typeof payload === "object" && payload != null && "rawContent" in payload) {
        // A response shaped wrongly by the provider reads as no answer at all.
        const blocks = (payload as RawResponse).rawContent as Array<{ text?: string }>;
        const text = blocks.find((block) => typeof block?.text === "string")?.text;
        return text === undefined
          ? { kind: "abstained", reason: "no text in response" }
          : { kind: "text", text };
      }
      const text = typeof payload === "string" ? payload : JSON.stringify(payload);
      return { kind: "text", text };
    },
  };
  return { client, calls };
}

function interpreter(client: ModelClient, overrides: Record<string, unknown> = {}) {
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

    const recognisedCommands = [
      ["eat", "EAT"],
      ["help", "HELP"],
      ["pick a place", "PICK_A_PLACE"],
      ["done", "DONE"],
      ["status", "STATUS"],
      ["change my answer", "CHANGE"],
      ["cancel", "CANCEL"],
      ["1", "VOTE"],
      ["veto 2", "VETO"],
      ["tell me more about option 3", "DETAILS"],
      ["STOP", "STOP"],
      ["START", "START"],
    ] as const;

    for (const [text, expectedKind] of recognisedCommands) {
      expect(parseCommand(text).kind).toBe(expectedKind);
      const result = await interpreter(client).interpret(input(text, "VOTING"));
      expect(result.source).toBe("rules");
    }
    expect(calls.count).toBe(0);
  });

  it("consults at the input cap and skips one character over it", async () => {
    const { client, calls } = stubClient(() => modelOutput());
    const subject = interpreter(client, { maxInputChars: 20 });

    const atCap = await subject.interpret(input("a".repeat(20)));
    const overCap = await subject.interpret(input("a".repeat(21)));

    expect(atCap.source).toBe("ai");
    expect(overCap.source).toBe("rules");
    expect(calls.count).toBe(1);
  });

  it("skips the model for whitespace-only input", async () => {
    const { client, calls } = stubClient(() => modelOutput());
    const result = await interpreter(client).interpret(input("   "));

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
    expect(errors[0]).toEqual(new Error("timed out"));
  });

  it("falls back cleanly when the response contains no text block", async () => {
    const errors: unknown[] = [];
    const { client } = stubClient(() => rawResponse([]));
    const result = await interpreter(client, {
      onError: (error: unknown) => errors.push(error),
    }).interpret(input("pizza please"));

    expect(result.source).toBe("rules");
    expect(result.preference?.preferredCuisines).toContain("pizza");
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

  it.each(["42", "[]"])("falls back when valid JSON is not an object: %s", async (json) => {
    const { client } = stubClient(() => json);
    const result = await interpreter(client).interpret(input("pizza please"));

    expect(result.source).toBe("rules");
    expect(result.preference?.preferredCuisines).toContain("pizza");
  });

  it("falls back when the model is not confident enough", async () => {
    const { client } = stubClient(() =>
      modelOutput({ intent: "CANCEL", confidence: 0.2 }),
    );
    const result = await interpreter(client).interpret(input("eh forget it maybe"));

    expect(result.source).toBe("rules");
    expect(result.command.kind).toBe("FREEFORM");
  });

  it("accepts confidence exactly at the configured threshold", async () => {
    const { client } = stubClient(() =>
      modelOutput({ intent: "CANCEL", confidence: 0.6 }),
    );
    const result = await interpreter(client).interpret(input("call the whole thing off"));

    expect(result.source).toBe("ai");
    expect(result.command.kind).toBe("CANCEL");
  });

  it("resolves a natural-language vote while voting", async () => {
    const { client, calls } = stubClient(() => modelOutput({ intent: "VOTE", option: 2 }));
    const result = await interpreter(client).interpret(
      input("the taco place works for me", "VOTING", ["Sushi Ya", "Taqueria Uno", "Pizza Pi"]),
    );

    expect(result.source).toBe("ai");
    expect(result.command).toEqual({ kind: "VOTE", option: 2 });
    // Retry policy is the client's now, not a per-request flag; what the
    // interpreter still owns is the deadline it is willing to wait.
    expect(calls.options[0]).toEqual({ timeout: 1_000 });
    const request = calls.requests[0] as { messages: Array<{ content: string }> };
    expect(request.messages[0]?.content).toContain("Sushi Ya");
    expect(request.messages[0]?.content).toContain("Taqueria Uno");
    expect(request.messages[0]?.content).toContain("Pizza Pi");
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
