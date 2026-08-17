import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { DiscordMessagingProvider } from "@/lib/messaging/discord-provider";

/**
 * Discord discards an interaction that is not acknowledged within three
 * seconds. A live restaurant search regularly takes longer, so the route
 * acknowledges with a deferral and sends every reply over the followup
 * webhook afterwards.
 *
 * These pin the half of that contract that is testable without a live
 * interaction: the first reply must *edit* the placeholder the deferral
 * created, and only later replies may append. Getting this backwards leaves a
 * permanent "Viand is thinking…" message sitting above the real answer.
 */

const ENV_KEYS = ["DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN", "DISCORD_PUBLIC_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.DISCORD_APPLICATION_ID = "123456789012345678";
  process.env.DISCORD_BOT_TOKEN = "bot-token";
  process.env.DISCORD_PUBLIC_KEY = "0".repeat(64);
  resetEnvCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
});

function recordingFetch(ok = true) {
  const calls: Array<{ url: string; method: string; content: string }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      content: (JSON.parse(String(init.body)) as { content: string }).content,
    });
    return { ok, status: ok ? 200 : 500 };
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("discord reply delivery after a deferral", () => {
  it("edits the deferred placeholder with the first reply", async () => {
    const { calls, impl } = recordingFetch();
    const provider = new DiscordMessagingProvider("token-1", impl);

    await provider.sendMessage({ chatId: "c", text: "first" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toContain("/webhooks/123456789012345678/token-1/messages/@original");
  });

  it("appends later replies instead of overwriting the first", async () => {
    const { calls, impl } = recordingFetch();
    const provider = new DiscordMessagingProvider("token-1", impl);

    await provider.sendMessage({ chatId: "c", text: "first" });
    await provider.sendMessage({ chatId: "c", text: "second" });

    expect(calls.map((call) => call.method)).toEqual(["PATCH", "POST"]);
    expect(calls[1]?.url).not.toContain("@original");
    expect(calls.map((call) => call.content)).toEqual(["first", "second"]);
  });

  it("treats each chunk of one long reply as a separate delivery", async () => {
    const { calls, impl } = recordingFetch();
    const provider = new DiscordMessagingProvider("token-1", impl);

    await provider.sendMessage({ chatId: "c", text: "x".repeat(2_500) });

    // Only the first chunk may edit the placeholder, or the tail overwrites
    // the head and the group sees the end of a message without its start.
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.map((call) => call.method)).toEqual([
      "PATCH",
      ...calls.slice(1).map(() => "POST"),
    ]);
  });

  it("raises when a reply cannot be delivered, rather than reporting success", async () => {
    const { impl } = recordingFetch(false);
    const provider = new DiscordMessagingProvider("token-1", impl);

    await expect(provider.sendMessage({ chatId: "c", text: "first" })).rejects.toThrow(/HTTP 500/);
  });

  it("refuses to send without an interaction token", async () => {
    const { impl } = recordingFetch();
    const provider = new DiscordMessagingProvider(undefined, impl);

    await expect(provider.sendMessage({ chatId: "c", text: "first" })).rejects.toThrow(
      /interaction token/,
    );
  });
});
