import { afterEach, describe, expect, it, vi } from "vitest";
import { DeterministicInterpreter } from "@/domain/interpret/deterministic";
import { SessionStoreCallBudget, DENY_ALL_BUDGET } from "@/lib/interpret/call-budget";
import { ClaudeInterpreter } from "@/lib/interpret/claude-interpreter";
import { InMemorySessionStore } from "@/lib/store/memory-store";
import type { ModelClient } from "@/lib/model/client";

const LIMITS = { perChatMax: 3, perChatWindowSeconds: 60, dailyMax: 5 };

function budget() {
  return new SessionStoreCallBudget(new InMemorySessionStore(), LIMITS);
}

afterEach(() => vi.restoreAllMocks());

describe("interpreter spending caps", () => {
  it("allows calls up to the per-chat limit and refuses beyond it", async () => {
    const b = budget();
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await b.check("chat-a"));

    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
    expect(results.slice(3).every((r) => !r.allowed)).toBe(true);
  });

  it("counts each chat separately, so one runaway cannot silence another", async () => {
    const b = budget();
    for (let i = 0; i < 4; i += 1) await b.check("noisy");

    await expect(b.check("quiet")).resolves.toEqual({ allowed: true });
  });

  /**
   * Breadth, not depth: many chats each politely under their own limit still
   * add up to a bill, so the daily ceiling is what actually bounds spend.
   */
  it("stops on the daily ceiling even when no chat exceeds its own limit", async () => {
    const b = budget();
    const decisions = [];
    for (const chat of ["a", "b", "c"]) {
      for (let i = 0; i < 2; i += 1) decisions.push(await b.check(chat));
    }

    expect(decisions.filter((d) => d.allowed)).toHaveLength(LIMITS.dailyMax);
    expect(decisions.at(-1)).toEqual({ allowed: false, reason: "daily_cap" });
  });

  /**
   * A cap that only counts the calls it permits can be probed past for free:
   * once tripped, further attempts would stop incrementing and the window
   * would drain while traffic continued.
   */
  it("charges attempts that were refused, not just the ones allowed", async () => {
    const store = new InMemorySessionStore();
    const b = new SessionStoreCallBudget(store, LIMITS);
    for (let i = 0; i < 6; i += 1) await b.check("chat-a");

    expect(await store.incrementCounter("interpreter:chat:chat-a", 60)).toBe(7);
  });

  it("refuses when no budget is configured rather than allowing an unbounded call", async () => {
    await expect(DENY_ALL_BUDGET.check("anything")).resolves.toMatchObject({ allowed: false });
  });
});

describe("an interpreter that has run out of budget", () => {
  function interpreterThatWouldCallTheModel(spend: boolean) {
    let modelCalls = 0;
    const client: ModelClient = {
      label: "stub/never-called",
      complete: async () => {
        modelCalls += 1;
        throw new Error("the model should not have been reached");
      },
    };

    const interpreter = new ClaudeInterpreter({
      client,
      model: "test",
      timeoutMs: 1_000,
      maxInputChars: 500,
      minConfidence: 0.6,
      fallback: new DeterministicInterpreter(),
      budget: spend ? budget() : DENY_ALL_BUDGET,
      onError: () => {},
    });
    return { interpreter, calls: () => modelCalls };
  }

  const input = {
    text: "the taco place works for me",
    command: { kind: "FREEFORM", text: "the taco place works for me" },
    state: "VOTING",
    chatId: "chat-a",
  } as const;

  it("still answers, using the deterministic parser, and never reaches the model", async () => {
    const { interpreter, calls } = interpreterThatWouldCallTheModel(false);

    // Degrading, not erroring: the rules parser is a complete implementation,
    // so the group loses phrasing coverage and nothing else.
    await expect(interpreter.interpret(input as never)).resolves.toBeTruthy();
    expect(calls()).toBe(0);
  });

  it("records why it fell back", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    const { interpreter } = interpreterThatWouldCallTheModel(false);
    await interpreter.interpret(input as never);

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.some((e) => e.event === "interpreter_fell_back")).toBe(true);
    expect(events.some((e) => e.cause === "no_budget_configured")).toBe(true);
    // The chat is referenced by digest, never named.
    expect(lines.join("\n")).not.toContain("chat-a");
  });
});
