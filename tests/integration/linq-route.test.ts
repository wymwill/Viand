import { Webhook } from "standardwebhooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/linq/route";
import { resetEnvCache } from "@/lib/env";
import { resetRuntime } from "@/lib/runtime";

const originalEnv = { ...process.env };
const secret = Buffer.from("viand-test-secret").toString("base64");

function payload(eventId: string): string {
  return JSON.stringify({
    api_version: "v3",
    created_at: new Date().toISOString(),
    event_id: eventId,
    event_type: "message.received",
    partner_id: "partner-1",
    trace_id: "trace-1",
    webhook_version: "2026-02-03",
    data: {
      id: "message-1",
      chat: {
        id: "chat-route-test",
        is_group: true,
        health_status: {
          status: "HEALTHY",
          reasons: [],
          doc_url: "https://docs.linqapp.com",
        },
      },
      direction: "inbound",
      parts: [{ type: "text", value: "pick a place" }],
      sender_handle: {
        id: "handle-1",
        handle: "+15555550100",
        joined_at: "2026-02-01T00:00:00Z",
        service: "iMessage",
      },
      service: "iMessage",
    },
  });
}

function signedRequest(body: string, valid = true): Request {
  const messageId = crypto.randomUUID();
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(messageId, timestamp, body);

  return new Request(
    "http://localhost:3000/api/webhooks/linq?version=2026-02-03",
    {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "webhook-id": messageId,
        "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
        "webhook-signature": valid ? signature : "v1,invalid",
      },
    },
  );
}

beforeEach(() => {
  process.env.LINQ_API_KEY = "test-api-key";
  process.env.LINQ_WEBHOOK_SECRET = secret;
  process.env.USE_MOCK_LINQ = "true";
  resetEnvCache();
  resetRuntime();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetEnvCache();
  resetRuntime();
});

describe("Linq webhook route", () => {
  it("verifies and processes a signed message.received event", async () => {
    const response = await POST(signedRequest(payload(crypto.randomUUID())));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      processed: true,
    });
  });

  it("rejects an invalid signature before message processing", async () => {
    const response = await POST(
      signedRequest(payload(crypto.randomUUID()), false),
    );

    expect(response.status).toBe(401);
  });
});
