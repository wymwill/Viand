import type { InboundMessage } from "../conversation/service";

/** The slice of Telegram's Update object this app consumes. */
export interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { id?: number };
  };
}

/**
 * Telegram appends "@BotName" to commands sent in a group, and its command
 * convention is a leading slash. Both are transport syntax rather than user
 * intent, so they are stripped here — leaving parseCommand to see the same
 * plain "eat" it receives from iMessage.
 *
 * wasInvoked reflects the "@BotName" mention specifically, not the leading
 * slash: with privacy mode disabled Viand receives every message in a group,
 * including slash commands addressed to *other* bots sharing the chat
 * ("/weather@WeatherBot"). Treating a bare slash as an invocation would make
 * Viand start a session on a command meant for someone else.
 */
export function normaliseTelegramMessage(text: string, botUsername?: string): { text: string; wasInvoked: boolean } {
  let result = text.trim();
  let wasInvoked = false;

  if (botUsername) {
    const mention = new RegExp(`@${botUsername}\\b`, "gi");
    wasInvoked = mention.test(result);
    result = result.replace(mention, " ");
  }

  result = result.replace(/^\/(?=\S)/, "");
  return { text: result.replace(/\s+/g, " ").trim(), wasInvoked };
}

export function normaliseTelegramText(text: string, botUsername?: string): string {
  return normaliseTelegramMessage(text, botUsername).text;
}

/**
 * Converts a Telegram webhook update into the internal message shape shared by
 * every transport. Anything that is not an inbound text message — edits,
 * callbacks, channel posts, stickers, photos — is acknowledged but ignored.
 */
export function inboundFromTelegram(
  update: TelegramUpdate,
  botUsername?: string,
): InboundMessage | null {
  if (typeof update.update_id !== "number") return null;

  const message = update.message;
  const chatId = message?.chat?.id;
  const senderId = message?.from?.id;

  if (!message || typeof chatId !== "number" || typeof senderId !== "number") {
    return null;
  }

  const { text, wasInvoked } = normaliseTelegramMessage(message.text ?? "", botUsername);
  if (!text && !wasInvoked) return null;

  const chatType = message.chat?.type;

  return {
    // update_id is stable across Telegram's retries, so it feeds the existing
    // idempotency gate the same way a Linq event id does.
    eventId: `telegram:${update.update_id}`,
    linqChatId: String(chatId),
    isGroup: chatType === "group" || chatType === "supergroup",
    // The numeric id, not the username: usernames are mutable, and member
    // identity has to stay stable across a decision session.
    senderHandle: `tg:${senderId}`,
    text,
    wasInvoked,
  };
}
