import { describe, expect, it } from "vitest";
import { DeterministicInterpreter } from "@/domain/interpret/deterministic";
import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import { handleInboundMessage, type InboundMessage } from "@/lib/conversation/service";
import { MockMessagingProvider } from "@/lib/messaging/mock-provider";
import { InMemorySessionStore } from "@/lib/store/memory-store";

function inbound(text: string, chatId = "chat-1"): InboundMessage {
  return {
    eventId: crypto.randomUUID(),
    linqChatId: chatId,
    isGroup: true,
    senderHandle: "+15555550100",
    text,
    wasInvoked: false,
  };
}

function invoked(text: string): InboundMessage {
  return { ...inbound(text), wasInvoked: true };
}

function dependencies() {
  return {
    store: new InMemorySessionStore(),
    messaging: new MockMessagingProvider(),
    restaurants: new MockRestaurantProvider(),
    interpreter: new DeterministicInterpreter(),
  };
}

describe("conversation session activation", () => {
  it("treats a stripped bare mention as the existing wake phrase", async () => {
    const deps = dependencies();
    const result = await handleInboundMessage(invoked(""), deps);
    expect(result.replies).toHaveLength(1);
    expect((await deps.store.load("chat-1"))?.snapshot.state).toBe("COLLECTING_LOCATION");
  });

  it.each(["help", "cancel"])("answers invoked %s without creating a session", async (text) => {
    const deps = dependencies();
    const result = await handleInboundMessage(invoked(text), deps);
    expect(result.replies).toHaveLength(1);
    expect(await deps.store.load("chat-1")).toBeNull();
  });

  it("ignores ordinary messages while a chat is idle", async () => {
    const deps = dependencies();
    const result = await handleInboundMessage(inbound("Downtown Berkeley"), deps);

    expect(result).toEqual({ processed: true, replies: [] });
    await expect(deps.store.load("chat-1")).resolves.toBeNull();
    expect(deps.messaging.sent).toHaveLength(0);
  });

  it("starts a session from a Viand wake phrase", async () => {
    const deps = dependencies();
    const result = await handleInboundMessage(inbound("Hey, @Viand!"), deps);

    expect(result.replies.at(-1)).toContain("what area");
    await expect(deps.store.load("chat-1")).resolves.toMatchObject({
      snapshot: { state: "COLLECTING_LOCATION" },
    });
    expect(deps.messaging.sent).toHaveLength(1);
  });

  it("activates on an explicit pick a place", async () => {
    const deps = dependencies();
    const result = await handleInboundMessage(inbound("pick a place"), deps);

    expect(result.replies.at(-1)).toContain("what area");
    await expect(deps.store.load("chat-1")).resolves.toMatchObject({
      snapshot: { state: "COLLECTING_LOCATION" },
    });
  });

  it("answers HELP while idle without starting a session", async () => {
    const deps = dependencies();
    const result = await handleInboundMessage(inbound("help"), deps);

    expect(result.replies.at(-1)).toContain("Here's how I work");
    // Answering must not park the chat mid-session, or the next unrelated
    // message would be read as a location.
    await expect(deps.store.load("chat-1")).resolves.toBeNull();

    const ignored = await handleInboundMessage(inbound("Downtown Berkeley"), deps);
    expect(ignored.replies).toEqual([]);
  });

  it("answers CANCEL while idle without starting a session", async () => {
    const deps = dependencies();
    const result = await handleInboundMessage(inbound("cancel"), deps);

    expect(result.replies.at(-1)).toContain("Nothing going right now");
    await expect(deps.store.load("chat-1")).resolves.toBeNull();
  });

  it("keeps taking votes mid-session without repeating the wake phrase", async () => {
    const deps = dependencies();
    await handleInboundMessage(inbound("Hey Viand"), deps);
    await handleInboundMessage(inbound("Downtown Berkeley"), deps);
    await handleInboundMessage(inbound("anything"), deps);
    await handleInboundMessage(inbound("done"), deps);

    await expect(deps.store.load("chat-1")).resolves.toMatchObject({
      snapshot: { state: "VOTING" },
    });

    const voted = await handleInboundMessage(inbound("2"), deps);
    expect(voted.processed).toBe(true);
    const chat = await deps.store.load("chat-1");
    expect(chat?.snapshot.ballots).toHaveLength(1);
  });

  it("requires another intentional invocation after a session ends", async () => {
    const deps = dependencies();
    await handleInboundMessage(inbound("Hey Viand"), deps);
    await handleInboundMessage(inbound("cancel"), deps);

    const ignored = await handleInboundMessage(inbound("Downtown Berkeley"), deps);
    expect(ignored.replies).toEqual([]);
    await expect(deps.store.load("chat-1")).resolves.toMatchObject({
      snapshot: { state: "CANCELLED" },
    });

    const restarted = await handleInboundMessage(inbound("Hi Viand"), deps);
    expect(restarted.replies.at(-1)).toContain("what area");
    await expect(deps.store.load("chat-1")).resolves.toMatchObject({
      snapshot: { state: "COLLECTING_LOCATION" },
    });
  });

  it("restarts a cancelled session on an explicit pick a place", async () => {
    const deps = dependencies();
    await handleInboundMessage(inbound("Hey Viand"), deps);
    await handleInboundMessage(inbound("cancel"), deps);

    const restarted = await handleInboundMessage(inbound("pick a place"), deps);
    expect(restarted.replies.at(-1)).toContain("what area");
    await expect(deps.store.load("chat-1")).resolves.toMatchObject({
      snapshot: { state: "COLLECTING_LOCATION" },
    });
  });
});
