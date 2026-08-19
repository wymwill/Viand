import { afterEach, describe, expect, it, vi } from "vitest";
import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import { DeterministicInterpreter } from "@/domain/interpret/deterministic";
import { handleInboundMessage } from "@/lib/conversation/service";
import { chatRef, logDegradation } from "@/lib/observability/log";
import { InMemorySessionStore } from "@/lib/store/memory-store";

function captureWarnings() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return { lines, restore: () => spy.mockRestore() };
}

afterEach(() => vi.restoreAllMocks());

describe("degradation logging", () => {
  it("emits one machine-readable line per degradation", () => {
    const { lines, restore } = captureWarnings();
    logDegradation("restaurant_search_failed", { chat: "abc12345" }, new Error("overpass down"));
    restore();

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(parsed.event).toBe("restaurant_search_failed");
    expect(parsed.chat).toBe("abc12345");
    expect(parsed.cause).toContain("overpass down");
  });

  /**
   * The two most useful fields to log are the two least defensible to keep.
   * A chat reference is a digest so lines can be correlated without the log
   * naming the conversation or anyone in it.
   */
  it("never reveals the chat it refers to", () => {
    const reference = chatRef("-1001234567890");
    expect(reference).not.toContain("1001234567890");
    expect(reference).toHaveLength(8);
    expect(chatRef("-1001234567890")).toBe(reference);
  });
});

describe("a reply that cannot be delivered", () => {
  const message = {
    eventId: "telegram:1",
    linqChatId: "-100999",
    isGroup: true,
    senderHandle: "tg:4242",
    text: "hey viand",
    wasInvoked: true,
  } as const;

  function deps(sendMessage: () => Promise<never>) {
    return {
      store: new InMemorySessionStore(),
      messaging: { sendMessage, createChat: async () => ({ chatId: "c", isGroup: true }) },
      restaurants: new MockRestaurantProvider(),
      interpreter: new DeterministicInterpreter(),
    };
  }

  it("degrades instead of throwing, so the transport is not told to retry", async () => {
    const { lines, restore } = captureWarnings();
    const failing = deps(async () => {
      throw new Error("Bad Request: chat not found");
    });

    // Before this, the throw escaped as a 500 and Telegram redelivered an
    // update that had already been processed.
    const result = await handleInboundMessage(message, failing as never);
    restore();

    expect(result.processed).toBe(true);
    expect(result.replies).toEqual([]);

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.some((event) => event.event === "reply_delivery_failed")).toBe(true);
  });

  it("logs no message content and no member handle", async () => {
    const { lines, restore } = captureWarnings();
    await handleInboundMessage(
      message,
      deps(async () => {
        throw new Error("chat not found");
      }) as never,
    );
    restore();

    const all = lines.join("\n");
    expect(all).not.toContain("hey viand");
    expect(all).not.toContain("tg:4242");
    expect(all).not.toContain("-100999");
  });
});
