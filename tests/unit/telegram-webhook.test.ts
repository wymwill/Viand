import { describe, expect, it } from "vitest";
import {
  inboundFromTelegram,
  normaliseTelegramText,
  type TelegramUpdate,
} from "@/lib/messaging/telegram-webhook";

function update(overrides: Record<string, unknown> = {}): TelegramUpdate {
  return {
    update_id: 42,
    message: {
      text: "pick a place",
      chat: { id: -100123, type: "supergroup" },
      from: { id: 555 },
    },
    ...overrides,
  } as TelegramUpdate;
}

describe("normaliseTelegramText", () => {
  it("strips the bot mention and command slash groups add", () => {
    expect(normaliseTelegramText("/eat@ViandBot", "ViandBot")).toBe("eat");
    expect(normaliseTelegramText("  /help ", "ViandBot")).toBe("help");
    expect(normaliseTelegramText("@ViandBot mexican", "ViandBot")).toBe("mexican");
  });

  it("leaves ordinary prose alone", () => {
    expect(normaliseTelegramText("Mexican under $25", "ViandBot")).toBe(
      "Mexican under $25",
    );
  });
});

describe("inboundFromTelegram", () => {
  it("normalizes a group text update for the conversation service", () => {
    expect(inboundFromTelegram(update(), "ViandBot")).toEqual({
      eventId: "telegram:42",
      linqChatId: "-100123",
      isGroup: true,
      senderHandle: "tg:555",
      text: "pick a place",
      wasInvoked: false,
    });
  });

  it("marks a private chat as not a group", () => {
    const inbound = inboundFromTelegram(
      update({
        message: {
          text: "hey viand",
          chat: { id: 777, type: "private" },
          from: { id: 555 },
        },
      }),
      "ViandBot",
    );

    expect(inbound?.isGroup).toBe(false);
    expect(inbound?.linqChatId).toBe("777");
  });

  it("ignores updates that carry no inbound text", () => {
    expect(inboundFromTelegram(update({ message: undefined }))).toBeNull();
    expect(inboundFromTelegram(update({ update_id: undefined }))).toBeNull();
    expect(
      inboundFromTelegram(
        update({
          message: { chat: { id: 1, type: "private" }, from: { id: 2 } },
        }),
      ),
    ).toBeNull();
  });
});
