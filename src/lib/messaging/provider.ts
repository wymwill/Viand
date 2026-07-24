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

export interface MessagingProvider {
  sendMessage(input: SendMessageInput): Promise<SentMessage>;
  createChat(input: CreateChatInput): Promise<MessagingChat>;
  updateGroup?(input: UpdateGroupInput): Promise<void>;
}

/** Linq caps recipients per chat; enforced before any create call. */
export const MAX_RECIPIENTS = 31;
/** A group chat needs at least three total participants (bot + two others). */
export const MIN_GROUP_PARTICIPANTS = 3;

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
