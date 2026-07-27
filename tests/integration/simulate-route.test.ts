import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/simulate/route";
import { resetEnvCache } from "@/lib/env";
import { resetMockMessagingProvider } from "@/lib/messaging";
import { resetRuntime } from "@/lib/runtime";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.USE_MOCK_LINQ = "false";
  process.env.LINQ_API_KEY = "unused-live-key";
  process.env.LINQ_PHONE_NUMBER = "+15555550123";
  process.env.LINQ_WEBHOOK_SECRET = "unused-live-secret";
  process.env.USE_MOCK_RESTAURANTS = "false";
  process.env.NOMINATIM_URL = "https://should-not-be-called.invalid/search";
  process.env.OVERPASS_URL = "https://should-not-be-called.invalid/interpreter";
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
  async function simulate(text: string) {
    const request = new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: "dashboard-demo",
        sender: "you",
        text,
      }),
    });
    return POST(request);
  }

  it("stays on mock messaging when live Linq mode is enabled", async () => {
    const response = await simulate("Hey Viand");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      processed: true,
      snapshot: { state: "COLLECTING_LOCATION" },
    });
  });

  it("never calls live restaurant sources from the public simulator", async () => {
    await simulate("Hey Viand");
    await simulate("Downtown Berkeley");
    await simulate("anything");
    const response = await simulate("done");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshot).toMatchObject({ state: "VOTING" });
    expect(body.replies.join("\n")).toContain("Demo results from a fixed sample catalogue");
  });
});
