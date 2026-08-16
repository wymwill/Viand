import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "@/lib/env";
import { resolveSessionStoreBackend } from "@/lib/store";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  resetEnvCache();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetEnvCache();
});

describe("resolveSessionStoreBackend", () => {
  it("uses memory when Redis credentials are absent", () => {
    expect(resolveSessionStoreBackend(getEnv())).toBe("memory");
  });

  it("uses Redis when both credentials are configured", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.com";
    process.env.UPSTASH_REDIS_REST_TOKEN = "secret";
    resetEnvCache();
    expect(resolveSessionStoreBackend(getEnv())).toBe("redis");
  });

  it.each(["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const)(
    "rejects partial configuration with only %s",
    (key) => {
      process.env[key] = key.endsWith("URL") ? "https://redis.example.com" : "secret";
      resetEnvCache();
      expect(() => getEnv()).toThrow(/must be set together/);
    },
  );
});
