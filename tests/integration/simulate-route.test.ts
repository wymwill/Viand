import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/simulate/route";
import { resetEnvCache } from "@/lib/env";
import { resetMockMessagingProvider } from "@/lib/messaging";
import { resetRuntime } from "@/lib/runtime";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.USE_MOCK_LINQ = "false";
  delete process.env.LINQ_API_KEY;
  delete process.env.LINQ_PHONE_NUMBER;
  delete process.env.LINQ_WEBHOOK_SECRET;
  resetEnvCache();
  resetRuntime();
  resetMockMessagingProvider();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetEnvCache();
  resetRuntime();
  resetMockMessagingProvider();
});

describe("dashboard simulator route", () => {
  // USE_MOCK_LINQ=false with no credentials makes getEnv() throw. The dashboard
  // must survive that: it never sends through Linq, and its restaurant provider
  // has to degrade to the demo catalogue rather than take the whole route down.
  it("stays on the mock provider when live Linq mode is enabled", async () => {
    const request = new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: "dashboard-demo",
        sender: "you",
        text: "Hey Viand",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      processed: true,
      snapshot: { state: "COLLECTING_LOCATION" },
    });
  });
});
