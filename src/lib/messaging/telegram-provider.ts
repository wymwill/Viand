import { getEnv } from "../env";
import {
  MessagingError,
  type ReplyOnlyMessagingProvider,
  type SendMessageInput,
  type SentMessage,
} from "./provider";

/** Telegram rejects any single message longer than this. */
export const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

type SendMessageResult = {
  ok: boolean;
  description?: string;
  result?: { message_id: number; chat: { id: number } };
};

/**
 * Splits text into Telegram-sized pieces, preferring a newline boundary so a
 * reply never breaks mid-sentence. Falls back to a hard cut when a single line
 * is itself longer than the limit.
 */
export function chunkForTelegram(
  text: string,
  limit = TELEGRAM_MAX_MESSAGE_CHARS,
): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = window.lastIndexOf("\n");
    const cut = breakAt > 0 ? breakAt : limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/**
 * Real messaging over the Telegram Bot API. Free to run: there is no
 * per-message cost and no registration beyond creating the bot in BotFather.
 *
 * A Telegram bot cannot open a conversation — the user must message it first —
 * which is why only sendMessage is implemented. That is sufficient because the
 * conversation service only ever replies into an existing chat.
 */
export class TelegramMessagingProvider implements ReplyOnlyMessagingProvider {
  readonly capabilities = {
    maxMessageLength: TELEGRAM_MAX_MESSAGE_CHARS,
    supportsThreads: true,
    supportsReactions: true,
    canCreateChat: false,
  } as const;
  private readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    const env = getEnv();
    if (!env.TELEGRAM_BOT_TOKEN) {
      throw new MessagingError(
        "TelegramMessagingProvider requires TELEGRAM_BOT_TOKEN. " +
          "Set MESSAGING_PROVIDER=mock to run without credentials.",
      );
    }
    this.apiBase = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
    this.timeoutMs = env.TELEGRAM_TIMEOUT_MS;
    this.fetchImpl = fetchImpl;
  }

  async sendMessage(input: SendMessageInput): Promise<SentMessage> {
    const chunks = chunkForTelegram(input.text);
    let last: SentMessage | null = null;

    // Sequential, not parallel: Telegram renders messages in arrival order, and
    // a reply that arrives out of order reads as nonsense.
    for (const chunk of chunks) {
      last = await this.postMessage(input.chatId, chunk);
    }

    if (!last) throw new MessagingError("sendMessage produced no chunks to send");
    return last;
  }

  private async postMessage(chatId: string, text: string): Promise<SentMessage> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBase}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new MessagingError(`Telegram sendMessage failed: ${detail}`);
    }

    const payload = (await response.json().catch(() => null)) as SendMessageResult | null;

    if (!response.ok || !payload?.ok || !payload.result) {
      const reason = payload?.description ?? `HTTP ${response.status}`;
      throw new MessagingError(`Telegram rejected sendMessage: ${reason}`);
    }

    return {
      messageId: String(payload.result.message_id),
      chatId: String(payload.result.chat.id),
    };
  }

}
