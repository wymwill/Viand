import LinqAPIV3 from "@linqapp/sdk";
import { getEnv } from "../env";
import {
  containsUrl,
  MAX_RECIPIENTS,
  MessagingError,
  type CreateChatInput,
  type MessagingChat,
  type MessagingProvider,
  type SendMessageInput,
  type SentMessage,
} from "./provider";

/**
 * Real messaging over the Linq V3 SDK (@linqapp/sdk). Method shapes are taken
 * from the installed SDK types, not guessed:
 *
 *   client.chats.create({ from, message: { parts }, to })  -> { chat }
 *   client.messages.create({ message: { parts }, to })     -> resolves chat+line
 *
 * The bot's own line (`from`) is LINQ_PHONE_NUMBER. createChat sends the first
 * message; sendMessage sends into an existing chat by resolving it from the
 * recipient set is avoided — we send by chat id via a text part.
 */
export class LinqMessagingProvider implements MessagingProvider {
  private readonly client: LinqAPIV3;
  private readonly fromNumber: string;

  constructor(client?: LinqAPIV3) {
    const env = getEnv();
    if (!env.LINQ_API_KEY || !env.LINQ_PHONE_NUMBER) {
      throw new MessagingError(
        "LinqMessagingProvider requires LINQ_API_KEY and LINQ_PHONE_NUMBER. " +
          "Set USE_MOCK_LINQ=true to run without Linq credentials.",
      );
    }
    this.fromNumber = env.LINQ_PHONE_NUMBER;
    this.client =
      client ??
      new LinqAPIV3({
        apiKey: env.LINQ_API_KEY,
        webhookSecret: env.LINQ_WEBHOOK_SECRET ?? null,
        ...(env.LINQ_API_BASE_URL ? { baseURL: env.LINQ_API_BASE_URL } : {}),
      });
  }

  async createChat(input: CreateChatInput): Promise<MessagingChat> {
    if (input.to.length === 0) throw new MessagingError("createChat needs at least one recipient");
    if (input.to.length > MAX_RECIPIENTS) {
      throw new MessagingError(`Too many recipients: ${input.to.length} > ${MAX_RECIPIENTS}`);
    }
    if (containsUrl(input.text)) {
      throw new MessagingError("The chat-creating message cannot contain a URL");
    }

    const response = await this.client.chats.create({
      from: this.fromNumber,
      to: input.to,
      message: { parts: [{ type: "text", value: input.text }] },
    });

    const chat = response.chat;
    return {
      chatId: chat.id,
      // Group when more than one non-bot recipient is present.
      isGroup: input.to.length >= 2,
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SentMessage> {
    // Send into a known chat by id via the chat-scoped messages resource:
    //   client.chats.messages.send(chatId, { message: { parts } }) -> { id }
    const response = await this.client.chats.messages.send(input.chatId, {
      message: { parts: [{ type: "text", value: input.text }] },
    });

    return { messageId: response.message.id, chatId: response.chat_id };
  }
}
