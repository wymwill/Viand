import { beforeEach, describe, expect, it } from "vitest";
import { MockMessagingProvider } from "@/lib/messaging/mock-provider";
import { containsUrl, MAX_RECIPIENTS, MessagingError } from "@/lib/messaging/provider";

describe("containsUrl", () => {
  it("detects links the first chat message may not contain", () => {
    expect(containsUrl("check https://maps.google.com/foo")).toBe(true);
    expect(containsUrl("visit viand.app for more")).toBe(true);
    expect(containsUrl("Let's pick a place")).toBe(false);
    expect(containsUrl("Tacoria wins 3-1")).toBe(false);
  });
});

describe("MockMessagingProvider", () => {
  let provider: MockMessagingProvider;
  beforeEach(() => {
    provider = new MockMessagingProvider();
  });

  it("records the opening message and flags a group", async () => {
    const chat = await provider.createChat({ to: ["+15550000001", "+15550000002"], text: "Hi" });
    expect(chat.isGroup).toBe(true);
    expect(provider.messagesFor(chat.chatId)).toEqual(["Hi"]);
  });

  it("treats a single recipient as one-to-one", async () => {
    const chat = await provider.createChat({ to: ["+15550000001"], text: "Hi" });
    expect(chat.isGroup).toBe(false);
  });

  it("rejects a URL in the chat-creating message", async () => {
    await expect(
      provider.createChat({ to: ["+15550000001"], text: "go to https://x.com" }),
    ).rejects.toBeInstanceOf(MessagingError);
  });

  it("allows a URL in a follow-up message", async () => {
    const chat = await provider.createChat({ to: ["+15550000001"], text: "Hi" });
    await provider.sendMessage({ chatId: chat.chatId, text: "Directions: https://maps.google.com" });
    expect(provider.messagesFor(chat.chatId)).toHaveLength(2);
  });

  it("enforces the recipient cap", async () => {
    const to = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `+1555000${1000 + i}`);
    await expect(provider.createChat({ to, text: "Hi" })).rejects.toBeInstanceOf(MessagingError);
  });
});
