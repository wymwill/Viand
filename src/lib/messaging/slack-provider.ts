import { getEnv } from "../env";
import {
  MessagingError,
  chunkMessage,
  type ReplyOnlyMessagingProvider,
  type SendMessageInput,
  type SentMessage,
} from "./provider";

/**
 * Slack accepts up to 40,000 characters in a message, far more than the other
 * transports, so chunking effectively never fires here — but the capability is
 * declared honestly rather than clamped to some smaller number the platform
 * does not actually impose.
 */
export const SLACK_MAX_MESSAGE_CHARS = 40_000;

export function chunkForSlack(text: string, limit = SLACK_MAX_MESSAGE_CHARS): string[] {
  return chunkMessage(text, limit);
}

interface SlackPostResult {
  readonly ok?: boolean;
  readonly error?: string;
  readonly ts?: string;
  readonly channel?: string;
}

export class SlackMessagingProvider implements ReplyOnlyMessagingProvider {
  readonly capabilities = {
    maxMessageLength: SLACK_MAX_MESSAGE_CHARS,
    supportsThreads: true,
    supportsReactions: true,
    // A Slack app is added to channels by a person; it cannot conjure one.
    canCreateChat: false,
  } as const;

  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    const env = getEnv();
    if (!env.SLACK_BOT_TOKEN) {
      throw new MessagingError(
        "SlackMessagingProvider requires SLACK_BOT_TOKEN. " +
          "Set MESSAGING_PROVIDER=mock to run without credentials.",
      );
    }
    this.token = env.SLACK_BOT_TOKEN;
    this.timeoutMs = env.SLACK_TIMEOUT_MS;
    this.fetchImpl = fetchImpl;
  }

  async sendMessage(input: SendMessageInput): Promise<SentMessage> {
    const chunks = chunkForSlack(input.text);
    let last: SentMessage | null = null;

    // Sequential, not parallel: Slack renders in arrival order and a reply
    // that lands out of order reads as nonsense.
    for (const chunk of chunks) {
      last = await this.postMessage(input.chatId, chunk);
    }

    if (!last) throw new MessagingError("sendMessage produced no chunks to send");
    return last;
  }

  private async postMessage(channel: string, text: string): Promise<SentMessage> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel, text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new MessagingError(`Slack chat.postMessage failed: ${detail}`);
    }

    // Slack answers 200 with ok:false for application errors, so the status
    // alone says nothing about whether the message was delivered.
    const payload = (await response.json().catch(() => null)) as SlackPostResult | null;
    if (!response.ok || !payload?.ok) {
      throw new MessagingError(
        `Slack rejected chat.postMessage: ${payload?.error ?? `HTTP ${response.status}`}`,
      );
    }

    return { messageId: payload.ts ?? "", chatId: payload.channel ?? channel };
  }
}
