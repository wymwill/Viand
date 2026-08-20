import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleInboundMessage } from "@/lib/conversation/service";
import { MockMessagingProvider } from "@/lib/messaging/mock-provider";
import { chunkMessage } from "@/lib/messaging/provider";
import { chunkForTelegram, TELEGRAM_MAX_MESSAGE_CHARS } from "@/lib/messaging/telegram-provider";
import { chunkForDiscord, DISCORD_MAX_MESSAGE_CHARS } from "@/lib/messaging/discord-provider";
import { chunkForSlack, SLACK_MAX_MESSAGE_CHARS } from "@/lib/messaging/slack-provider";
import { inboundFromSlack, normaliseSlackText } from "@/lib/messaging/slack-webhook";
import { normalisePlainMention } from "@/lib/messaging/mention";
import { normaliseTelegramMessage } from "@/lib/messaging/telegram-webhook";
import { inboundFromDiscord, normaliseDiscordText } from "@/lib/messaging/discord-webhook";
import { parseCommand } from "@/domain/commands";
import {
  constantTimeEqual,
  verifyDiscordSignature,
  verifySlackSignature,
} from "@/lib/messaging/verify-signature";
import { createHmac } from "node:crypto";
import { InMemorySessionStore } from "@/lib/store/memory-store";
import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import { DeterministicInterpreter } from "@/domain/interpret/deterministic";

describe("messaging adapter conformance", () => {
  it.each([
    ["linq/mock", () => normalisePlainMention("@Viand pick a place")],
    ["telegram", () => normaliseTelegramMessage("/pick@ViandBot", "ViandBot")],
    ["discord", () => normaliseDiscordText("<@123> pick a place")],
    ["slack", () => normaliseSlackText("<@U0BOT> pick a place", "U0BOT")],
  ])("normalises %s mentions before the domain", (_name, normalise) => {
    const result = normalise();
    expect(result.wasInvoked).toBe(true);
    expect(result.text).not.toMatch(/@Viand|<@/i);
  });

  it.each([
    ["linq/mock", (text: string) => chunkMessage(text, 10_000), 10_000],
    ["telegram", chunkForTelegram, TELEGRAM_MAX_MESSAGE_CHARS],
    ["discord", chunkForDiscord, DISCORD_MAX_MESSAGE_CHARS],
    ["slack", chunkForSlack, SLACK_MAX_MESSAGE_CHARS],
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

describe("plain mention normalisation", () => {
  it("recognises a standalone mention", () => {
    expect(normalisePlainMention("@Viand pick a place")).toEqual({
      text: "pick a place",
      wasInvoked: true,
    });
  });

  /**
   * A word-boundary match also fired inside an email address, which both
   * mangled the address and set wasInvoked, so an ordinary message could start
   * a decision session nobody asked for.
   */
  it.each([
    "ping person@viand.com about lunch",
    "email me at bob@viand.io",
    "see support@viand.co.uk",
  ])("leaves %j untouched and uninvoked", (text) => {
    expect(normalisePlainMention(text)).toEqual({ text, wasInvoked: false });
  });
});

describe("slack inbound", () => {
  const envelope = (event: Record<string, unknown>, id = "Ev1") => ({
    type: "event_callback",
    event_id: id,
    event: { type: "message", channel: "C123", user: "U9", ts: "1", ...event },
  });

  it("normalises a mention and reports the message as addressed to Viand", () => {
    const inbound = inboundFromSlack(envelope({ text: "<@U0BOT> pick a place" }), "U0BOT");

    expect(inbound?.text).toBe("pick a place");
    expect(inbound?.wasInvoked).toBe(true);
    expect(inbound?.eventId).toBe("slack:Ev1");
  });

  /**
   * Viand's own replies arrive back through the same events feed. Without this
   * it would read its own shortlist, answer it, and never stop.
   */
  it("ignores messages from bots, including its own", () => {
    expect(inboundFromSlack(envelope({ text: "hello", bot_id: "B1" }), "U0BOT")).toBeNull();
  });

  it("ignores edits and deletions rather than treating them as new messages", () => {
    expect(
      inboundFromSlack(envelope({ text: "hi", subtype: "message_changed" }), "U0BOT"),
    ).toBeNull();
  });

  it("leaves another person's mention alone and does not count it as an invocation", () => {
    const inbound = inboundFromSlack(envelope({ text: "<@U777> what about tacos" }), "U0BOT");

    expect(inbound?.wasInvoked).toBe(false);
    expect(inbound?.text).toBe("what about tacos");
  });

  it("reads a link the way a person sees it", () => {
    const inbound = inboundFromSlack(
      envelope({ text: "here <https://example.test|this place>" }),
      "U0BOT",
    );

    expect(inbound?.text).toBe("here this place");
  });

  it("treats a direct message channel as one-to-one and a channel as a group", () => {
    expect(inboundFromSlack(envelope({ text: "hi", channel: "D1" }), "U0BOT")?.isGroup).toBe(false);
    expect(inboundFromSlack(envelope({ text: "hi", channel: "C1" }), "U0BOT")?.isGroup).toBe(true);
  });
});

describe("slack signature verification", () => {
  const secret = "shhh";
  const body = '{"type":"event_callback"}';
  const sign = (timestamp: string, rawBody = body) =>
    "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");

  it("accepts a correctly signed, recent delivery", () => {
    const now = new Date();
    const timestamp = String(Math.floor(now.getTime() / 1000));

    expect(
      verifySlackSignature({ signingSecret: secret, signature: sign(timestamp), timestamp, rawBody: body, now }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const now = new Date();
    const timestamp = String(Math.floor(now.getTime() / 1000));

    expect(
      verifySlackSignature({
        signingSecret: secret,
        signature: sign(timestamp),
        timestamp,
        rawBody: '{"type":"tampered"}',
        now,
      }),
    ).toBe(false);
  });

  /**
   * A valid signature never expires on its own, so without a freshness window
   * a captured request could be replayed forever.
   */
  it("rejects a correctly signed delivery that is hours old", () => {
    const now = new Date();
    const stale = String(Math.floor(now.getTime() / 1000) - 60 * 60 * 3);

    expect(
      verifySlackSignature({ signingSecret: secret, signature: sign(stale), timestamp: stale, rawBody: body, now }),
    ).toBe(false);
  });
});
