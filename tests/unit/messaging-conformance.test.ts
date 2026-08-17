import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleInboundMessage } from "@/lib/conversation/service";
import { MockMessagingProvider } from "@/lib/messaging/mock-provider";
import { chunkMessage } from "@/lib/messaging/provider";
import { chunkForTelegram, TELEGRAM_MAX_MESSAGE_CHARS } from "@/lib/messaging/telegram-provider";
import { chunkForDiscord, DISCORD_MAX_MESSAGE_CHARS } from "@/lib/messaging/discord-provider";
import { normalisePlainMention } from "@/lib/messaging/mention";
import { normaliseTelegramMessage } from "@/lib/messaging/telegram-webhook";
import { inboundFromDiscord, normaliseDiscordText } from "@/lib/messaging/discord-webhook";
import { parseCommand } from "@/domain/commands";
import { constantTimeEqual, verifyDiscordSignature } from "@/lib/messaging/verify-signature";
import { InMemorySessionStore } from "@/lib/store/memory-store";
import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import { DeterministicInterpreter } from "@/domain/interpret/deterministic";

describe("messaging adapter conformance", () => {
  it.each([
    ["linq/mock", () => normalisePlainMention("@Viand pick a place")],
    ["telegram", () => normaliseTelegramMessage("/pick@ViandBot", "ViandBot")],
    ["discord", () => normaliseDiscordText("<@123> pick a place")],
  ])("normalises %s mentions before the domain", (_name, normalise) => {
    const result = normalise();
    expect(result.wasInvoked).toBe(true);
    expect(result.text).not.toMatch(/@Viand|<@/i);
  });

  it.each([
    ["linq/mock", (text: string) => chunkMessage(text, 10_000), 10_000],
    ["telegram", chunkForTelegram, TELEGRAM_MAX_MESSAGE_CHARS],
    ["discord", chunkForDiscord, DISCORD_MAX_MESSAGE_CHARS],
  ])("splits %s outbound messages to its declared maximum", (_name, chunk, limit) => {
    expect(chunk("x".repeat(limit + 1)).every((part) => part.length <= limit)).toBe(true);
  });

  it("deduplicates replayed adapter event ids", async () => {
    const store = new InMemorySessionStore();
    const deps = { store, messaging: new MockMessagingProvider(), restaurants: new MockRestaurantProvider(), interpreter: new DeterministicInterpreter() };
    const message = { eventId: "discord:1", linqChatId: "c", isGroup: true, senderHandle: "discord:1", text: "pick a place", wasInvoked: true } as const;
    expect((await handleInboundMessage(message, deps)).processed).toBe(true);
    expect((await handleInboundMessage(message, deps)).processed).toBe(false);
  });

  it("rejects bad shared-secret and Ed25519 signatures", () => {
    expect(constantTimeEqual("bad", "secret")).toBe(false);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const rawKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const timestamp = "123";
    const rawBody = '{"type":1}';
    const signature = sign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex");
    expect(verifyDiscordSignature({ publicKeyHex: rawKey.toString("hex"), signatureHex: signature, timestamp, rawBody })).toBe(true);
    expect(verifyDiscordSignature({ publicKeyHex: rawKey.toString("hex"), signatureHex: signature, timestamp, rawBody: "tampered" })).toBe(false);
  });
});

describe("discord slash command inbound", () => {
  function interaction(options: string[] = []) {
    return inboundFromDiscord({
      id: "i1",
      type: 2,
      token: "t",
      guild_id: "g1",
      channel_id: "c1",
      member: { user: { id: "u1" } },
      data: { name: "eat", options: options.map((value) => ({ name: "message", value })) },
    });
  }

  /**
   * The slash command name is transport syntax, not content. Leaving it in the
   * text made every deterministic command degrade to FREEFORM on Discord —
   * "/eat 2" parsed as prose rather than a vote — which breaks voting, vetoes,
   * DONE and CANCEL, and pushes compliance keywords at a model that must never
   * see them.
   */
  it.each([
    ["2", { kind: "VOTE", option: 2 }],
    ["done", { kind: "DONE" }],
    ["cancel", { kind: "CANCEL" }],
    ["help", { kind: "HELP" }],
    ["veto 3", { kind: "VETO", option: 3 }],
  ])("parses /eat %s as the deterministic command, not prose", (argument, expected) => {
    const inbound = interaction([argument]);
    expect(inbound).not.toBeNull();
    expect(parseCommand(inbound!.text)).toEqual(expected);
  });

  it("treats a bare /eat as an explicit invocation with no content", () => {
    const inbound = interaction();
    expect(inbound?.text).toBe("");
    expect(inbound?.wasInvoked).toBe(true);
  });

  it("keeps preference prose intact", () => {
    expect(interaction(["mexican under $25"])?.text).toBe("mexican under $25");
  });
});
