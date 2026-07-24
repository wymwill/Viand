import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/linq/status/route";
import { resetEnvCache } from "@/lib/env";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.LINQ_API_KEY;
  delete process.env.LINQ_PHONE_NUMBER;
  delete process.env.LINQ_WEBHOOK_SECRET;
  process.env.USE_MOCK_LINQ = "true";
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetEnvCache();
});

describe("Linq connection status", () => {
  it("labels the credential-free environment as demo mode", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: "demo",
      label: "DEMO MODE",
      phoneNumber: null,
    });
  });

  it("fails closed when live mode is missing credentials", async () => {
    process.env.USE_MOCK_LINQ = "false";
    resetEnvCache();

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      mode: "error",
      label: "LINQ MISCONFIGURED",
      phoneNumber: null,
    });
  });
});
