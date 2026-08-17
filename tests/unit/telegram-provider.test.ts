import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { MessagingError } from "@/lib/messaging/provider";
import {
  chunkForTelegram,
  TelegramMessagingProvider,
  TELEGRAM_MAX_MESSAGE_CHARS,
} from "@/lib/messaging/telegram-provider";

const originalEnv = { ...process.env };

function okResponse(messageId: number, chatId: number): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      result: { message_id: messageId, chat: { id: chatId } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  process.env.MESSAGING_PROVIDER = "telegram";
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetEnvCache();
});

describe("chunkForTelegram", () => {
  it("leaves a short message as one piece", () => {
    expect(chunkForTelegram("short")).toEqual(["short"]);
  });

  it("splits past the limit, preferring a newline boundary", () => {
    const line = "x".repeat(1000);
    const text = Array.from({ length: 6 }, () => line).join("\n");
    const chunks = chunkForTelegram(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
    }
    expect(chunks.join("\n")).toBe(text);
  });

  it("hard-cuts a single line that exceeds the limit on its own", () => {
    const chunks = chunkForTelegram("y".repeat(5000));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(TELEGRAM_MAX_MESSAGE_CHARS);
  });
});

describe("TelegramMessagingProvider", () => {
  it("sends a message and maps Telegram's ids back", async () => {
    // mockImplementation, not mockResolvedValue: a Response body can only be
    // read once, so every call needs a fresh one.
    const fetchImpl = vi.fn().mockImplementation(() => okResponse(9, -100123));
    const provider = new TelegramMessagingProvider(fetchImpl as unknown as typeof fetch);

    const sent = await provider.sendMessage({ chatId: "-100123", text: "hi" });

    expect(sent).toEqual({ messageId: "9", chatId: "-100123" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: "-100123",
      text: "hi",
    });
  });

  it("sends one request per chunk for an over-long reply", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => okResponse(1, 5));
    const provider = new TelegramMessagingProvider(fetchImpl as unknown as typeof fetch);

    await provider.sendMessage({ chatId: "5", text: "z".repeat(9000) });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("raises MessagingError when Telegram reports failure", async () => {
    const fetchImpl = vi.fn().mockImplementation(
      () =>
        new Response(JSON.stringify({ ok: false, description: "chat not found" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    );
    const provider = new TelegramMessagingProvider(fetchImpl as unknown as typeof fetch);

    await expect(
      provider.sendMessage({ chatId: "nope", text: "hi" }),
    ).rejects.toThrow(/chat not found/);
  });

  it("declares that it cannot create a chat", () => {
    const provider = new TelegramMessagingProvider(vi.fn() as unknown as typeof fetch);
    expect(provider.capabilities.canCreateChat).toBe(false);
    expect("createChat" in provider).toBe(false);
  });
});
