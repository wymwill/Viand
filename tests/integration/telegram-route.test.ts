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
});
