import { getEnv } from "../env";
import { MessagingError, type ReplyOnlyMessagingProvider, type SendMessageInput, type SentMessage } from "./provider";

export const DISCORD_MAX_MESSAGE_CHARS = 2_000;

export function chunkForDiscord(text: string, limit = DISCORD_MAX_MESSAGE_CHARS): string[] {
  const chunks: string[] = [];
  let rest = text;
  do {
    const window = rest.slice(0, limit);
    const cut = rest.length > limit && window.lastIndexOf("\n") > 0 ? window.lastIndexOf("\n") : limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  } while (rest.length > 0);
  return chunks;
}

export class DiscordMessagingProvider implements ReplyOnlyMessagingProvider {
  readonly capabilities = {
    maxMessageLength: DISCORD_MAX_MESSAGE_CHARS,
    supportsThreads: true,
    supportsReactions: true,
    canCreateChat: false,
  } as const;
  private readonly fetchImpl: typeof fetch;
  private readonly applicationId: string;
  private readonly interactionToken?: string;
  private counter = 0;

  constructor(interactionToken?: string, fetchImpl: typeof fetch = fetch) {
    const env = getEnv();
    if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_BOT_TOKEN) {
      throw new MessagingError("DiscordMessagingProvider requires DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN.");
    }
    this.applicationId = env.DISCORD_APPLICATION_ID;
    this.interactionToken = interactionToken;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Every reply is a webhook call, because the route defers before any work
   * starts. Discord gives an interaction three seconds to be acknowledged, and
   * a live restaurant search does not reliably finish in three seconds, so
   * there is no reply available at acknowledgement time to return inline.
   *
   * The first call edits the "thinking" placeholder the deferral created;
   * later calls post additional messages. Editing rather than appending
   * matters — otherwise the placeholder sits above the real answer forever.
   */
  async sendMessage(input: SendMessageInput): Promise<SentMessage> {
    if (!this.interactionToken) {
      throw new MessagingError("Discord replies require an interaction token.");
    }

    for (const chunk of chunkForDiscord(input.text)) {
      const isFirst = this.counter === 0;
      const base = `https://discord.com/api/v10/webhooks/${this.applicationId}/${this.interactionToken}`;
      const response = await this.fetchImpl(isFirst ? `${base}/messages/@original` : base, {
        method: isFirst ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunk }),
      });
      if (!response.ok) {
        throw new MessagingError(`Discord reply failed: HTTP ${response.status}`);
      }
      this.counter += 1;
    }

    return { messageId: `discord:${this.counter}`, chatId: input.chatId };
  }
}
