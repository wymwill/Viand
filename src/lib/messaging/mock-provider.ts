import {
  containsUrl,
  chunkMessage,
  MAX_RECIPIENTS,
  MessagingError,
  type CreateChatInput,
  type MessagingChat,
  type ChatCreatingMessagingProvider,
  type SendMessageInput,
  type SentMessage,
  type UpdateGroupInput,
} from "./provider";

export interface RecordedMessage {
  chatId: string;
  text: string;
}

/**
 * In-memory messaging used in development, tests, and the conversation
 * simulator. It records everything it "sends" so a caller can assert on the
 * conversation, and it enforces the same Linq constraints as the real provider
 * so those rules are exercised without a live account.
 */
export class MockMessagingProvider implements ChatCreatingMessagingProvider {
  readonly capabilities = {
    maxMessageLength: 10_000,
    supportsThreads: false,
    supportsReactions: false,
    canCreateChat: true,
  } as const;
  readonly sent: RecordedMessage[] = [];
  readonly chats: MessagingChat[] = [];
  private counter = 0;

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
  }

  async createChat(input: CreateChatInput): Promise<MessagingChat> {
    if (input.to.length === 0) throw new MessagingError("createChat needs at least one recipient");
    if (input.to.length > MAX_RECIPIENTS) {
      throw new MessagingError(`Too many recipients: ${input.to.length} > ${MAX_RECIPIENTS}`);
    }
    if (containsUrl(input.text)) {
      throw new MessagingError("The chat-creating message cannot contain a URL");
    }
    const chat: MessagingChat = {
      chatId: this.nextId("chat"),
      // Bot + 2+ others = group. `to` excludes the bot's own line.
      isGroup: input.to.length >= 2,
    };
    this.chats.push(chat);
    this.sent.push({ chatId: chat.chatId, text: input.text });
    return chat;
  }

  async sendMessage(input: SendMessageInput): Promise<SentMessage> {
    for (const text of chunkMessage(input.text, this.capabilities.maxMessageLength)) {
      this.sent.push({ chatId: input.chatId, text });
    }
    return { messageId: this.nextId("msg"), chatId: input.chatId };
  }

  async updateGroup(_input: UpdateGroupInput): Promise<void> {
    // No-op in the mock; recorded intentionally as unsupported detail.
  }

  /** Test/simulator helper. */
  messagesFor(chatId: string): string[] {
    return this.sent.filter((message) => message.chatId === chatId).map((message) => message.text);
  }
}
