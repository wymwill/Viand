import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/telegram/route";
import { resetEnvCache } from "@/lib/env";
import { resetRuntime } from "@/lib/runtime";

const originalEnv = { ...process.env };
const secret = "viand-telegram-test-secret";

function updateBody(updateId: number): string {
  return JSON.stringify({
    update_id: updateId,
    message: {
      message_id: 1,
      text: "Hey Viand",
      chat: { id: -100999, type: "supergroup" },
      from: { id: 4242, username: "diner" },
    },
  });
}

function request(body: string, token: string = secret): Request {
  return new Request("http://localhost:3000/api/webhooks/telegram", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": token,
    },
  });
}

beforeEach(() => {
  // Routed as Telegram, but delivery stays on the mock so the test never makes
  // a network call: MESSAGING_PROVIDER is left at mock deliberately.
  process.env.MESSAGING_PROVIDER = "mock";
  process.env.TELEGRAM_WEBHOOK_SECRET = secret;
  process.env.TELEGRAM_BOT_USERNAME = "ViandBot";
  resetEnvCache();
  resetRuntime();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetEnvCache();
  resetRuntime();
});

describe("Telegram webhook route", () => {
  it("accepts and processes an update carrying the right secret token", async () => {
    const response = await POST(request(updateBody(1)));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      processed: true,
    });
  });

  it("rejects a wrong secret token before processing", async () => {
    const response = await POST(request(updateBody(2), "not-the-secret"));

    expect(response.status).toBe(401);
  });

  it("rejects a missing secret token", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/webhooks/telegram", {
        method: "POST",
        body: updateBody(3),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("acknowledges an update with nothing to process", async () => {
    const response = await POST(
      request(JSON.stringify({ update_id: 4, edited_message: { text: "oops" } })),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      processed: false,
    });
  });

  it("drops a duplicate update id, satisfying Telegram's retries", async () => {
    await POST(request(updateBody(7)));
    const replay = await POST(request(updateBody(7)));

    await expect(replay.json()).resolves.toEqual({
      accepted: true,
      processed: false,
    });
  });

  it("processes a Telegram delivery while another transport is the configured default", async () => {
    // The capability that lets one deployment run Telegram and Discord at
    // once: MESSAGING_PROVIDER names a different transport, but Telegram is
    // fully configured, so its own route still answers it.
    process.env.MESSAGING_PROVIDER = "discord";
    process.env.DISCORD_APPLICATION_ID = "123456789012345678";
    process.env.DISCORD_PUBLIC_KEY = "0".repeat(64);
    process.env.DISCORD_BOT_TOKEN = "discord-token";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    resetEnvCache();
    resetRuntime();

    const sent: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      sent.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 1, chat: { id: -100999 } } }),
      };
    }) as unknown as typeof fetch;

    try {
      const response = await POST(request(updateBody(9)));
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({ accepted: true, processed: true });
      // Answered over Telegram, never over the configured default.
      expect(sent.every((url) => url.includes("api.telegram.org"))).toBe(true);
      expect(sent.some((url) => url.includes("discord.com"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  /**
   * A route serves its own transport whenever that transport can answer, so
   * one deployment can run Telegram and Discord at once. What must never
   * happen is a Telegram conversation being answered over a different
   * transport — so with another provider configured and no Telegram bot token
   * available to reply with, the delivery is refused rather than processed.
   */
  it("refuses a Telegram delivery it has no Telegram credentials to answer", async () => {
    process.env.MESSAGING_PROVIDER = "linq";
    process.env.LINQ_API_KEY = "test-api-key";
    process.env.LINQ_PHONE_NUMBER = "+15555550123";
    process.env.LINQ_WEBHOOK_SECRET = "linq-secret";
    delete process.env.TELEGRAM_BOT_TOKEN;
    resetEnvCache();

    const response = await POST(request(updateBody(8)));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      processed: false,
    });
  });
});
