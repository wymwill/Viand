import { parseCommand } from "@/domain/commands";
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
 * A message counts as addressed to Viand when it either carries the "@BotName"
 * mention, or is a slash command that Viand actually recognises.
 *
 * That second clause matters and is narrower than it looks. Telegram only
 * appends "@BotName" when more than one bot is in the chat, so picking /eat
 * from the command menu usually sends a bare "/eat" — which was being ignored,
 * making the bot's own advertised command do nothing. Requiring the command to
 * parse to something known keeps the original protection intact: with privacy
 * mode disabled Viand sees every message, and "/weather" meant for another bot
 * parses to FREEFORM and is still ignored.
 */
export function normaliseTelegramMessage(text: string, botUsername?: string): { text: string; wasInvoked: boolean } {
  let result = text.trim();
  let wasInvoked = false;

  if (botUsername) {
    const mention = new RegExp(`@${botUsername}\\b`, "gi");
    wasInvoked = mention.test(result);
    result = result.replace(mention, " ");
  }

  const hadLeadingSlash = /^\/(?=\S)/.test(result);
  result = result.replace(/^\/(?=\S)/, "").replace(/\s+/g, " ").trim();

  if (!wasInvoked && hadLeadingSlash && parseCommand(result).kind !== "FREEFORM") {
    wasInvoked = true;
  }

  return { text: result, wasInvoked };
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
