/**
 * The seam between the application and whatever moves messages. Both the real
 * Linq SDK and the in-memory mock implement this, so the entire product runs
 * end to end with no Linq account when USE_MOCK_LINQ=true.
 */

export interface MessagePart {
  type: "text";
  value: string;
}

export interface SendMessageInput {
  /** Existing Linq chat id to send into. */
  chatId: string;
  text: string;
}

export interface SentMessage {
  messageId: string;
  chatId: string;
}

export interface CreateChatInput {
  /** Recipients in E.164. A group needs at least three total participants. */
  to: string[];
  /**
   * First message body. Must not contain a URL: Linq forbids a URL in the
   * message that creates a chat. Send links in a follow-up sendMessage.
   */
  text: string;
}

export interface MessagingChat {
  chatId: string;
  isGroup: boolean;
}

export interface UpdateGroupInput {
  chatId: string;
  name?: string;
}

export interface MessagingCapabilities {
  readonly maxMessageLength: number;
  readonly supportsThreads: boolean;
  readonly supportsReactions: boolean;
  readonly canCreateChat: boolean;
}

interface BaseMessagingProvider {
  readonly capabilities: MessagingCapabilities;
  sendMessage(input: SendMessageInput): Promise<SentMessage>;
  updateGroup?(input: UpdateGroupInput): Promise<void>;
}

export interface ChatCreatingMessagingProvider extends BaseMessagingProvider {
  readonly capabilities: MessagingCapabilities & { readonly canCreateChat: true };
  createChat(input: CreateChatInput): Promise<MessagingChat>;
}

export interface ReplyOnlyMessagingProvider extends BaseMessagingProvider {
  readonly capabilities: MessagingCapabilities & { readonly canCreateChat: false };
}

export type MessagingProvider = ChatCreatingMessagingProvider | ReplyOnlyMessagingProvider;

/** Linq caps recipients per chat; enforced before any create call. */
export const MAX_RECIPIENTS = 31;
/** A group chat needs at least three total participants (bot + two others). */
export const MIN_GROUP_PARTICIPANTS = 3;

export function chunkMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const newline = window.lastIndexOf("\n");
    const cut = newline > 0 ? newline : limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const URL_PATTERN = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|app|co)\b/i;

/** True when text contains something Linq would treat as a link. */
export function containsUrl(text: string): boolean {
  return URL_PATTERN.test(text);
}

export class MessagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessagingError";
  }
}
