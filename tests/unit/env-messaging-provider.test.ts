import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache, resolveMessagingProvider } from "@/lib/env";

const originalEnv = { ...process.env };

function clearMessagingEnv(): void {
  for (const key of [
    "MESSAGING_PROVIDER",
    "USE_MOCK_LINQ",
    "LINQ_API_KEY",
    "LINQ_PHONE_NUMBER",
    "LINQ_WEBHOOK_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "DISCORD_PUBLIC_KEY",
    "DISCORD_BOT_TOKEN",
    "DISCORD_APPLICATION_ID",
  ]) {
    delete process.env[key];
  }
  resetEnvCache();
}

beforeEach(clearMessagingEnv);

afterEach(() => {
  process.env = { ...originalEnv };
  resetEnvCache();
});

describe("resolveMessagingProvider", () => {
  it("falls back to USE_MOCK_LINQ when MESSAGING_PROVIDER is unset", () => {
    expect(resolveMessagingProvider(getEnv())).toBe("mock");

    process.env.USE_MOCK_LINQ = "false";
    process.env.LINQ_API_KEY = "key";
    process.env.LINQ_PHONE_NUMBER = "+15555550123";
    process.env.LINQ_WEBHOOK_SECRET = "secret";
    resetEnvCache();

    expect(resolveMessagingProvider(getEnv())).toBe("linq");
  });

  it("lets MESSAGING_PROVIDER win over the legacy flag", () => {
    process.env.MESSAGING_PROVIDER = "telegram";
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "secret";
    process.env.USE_MOCK_LINQ = "true";
    resetEnvCache();

    expect(resolveMessagingProvider(getEnv())).toBe("telegram");
  });
});

describe("messaging credential validation", () => {
  it("validates a Telegram deploy with no LINQ_* variables at all", () => {
    // The regression this guards: USE_MOCK_LINQ=false left over from an
    // iMessage deploy must not demand Linq keys once Telegram is selected.
    process.env.MESSAGING_PROVIDER = "telegram";
    process.env.USE_MOCK_LINQ = "false";
    process.env.TELEGRAM_BOT_TOKEN = "token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "secret";
    resetEnvCache();

    expect(() => getEnv()).not.toThrow();
  });

  it("still requires Linq credentials when linq is selected", () => {
    process.env.MESSAGING_PROVIDER = "linq";
    resetEnvCache();

    expect(() => getEnv()).toThrow(/LINQ_API_KEY/);
  });

  it("requires a bot token and secret when telegram is selected", () => {
    process.env.MESSAGING_PROVIDER = "telegram";
    resetEnvCache();

    expect(() => getEnv()).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("requires public key, bot token, and application id when discord is selected", () => {
    process.env.MESSAGING_PROVIDER = "discord";
    resetEnvCache();

    expect(() => getEnv()).toThrow(/DISCORD_PUBLIC_KEY/);
  });

  it("validates a Discord deploy once all three settings are present", () => {
    process.env.MESSAGING_PROVIDER = "discord";
    process.env.DISCORD_PUBLIC_KEY = "a".repeat(64);
    process.env.DISCORD_BOT_TOKEN = "token";
    process.env.DISCORD_APPLICATION_ID = "123456789";
    resetEnvCache();

    expect(() => getEnv()).not.toThrow();
    expect(resolveMessagingProvider(getEnv())).toBe("discord");
  });
});
