import type { SessionSnapshot } from "@/domain/state-machine/session";

/**
 * A chat plus its current decision session, as the application persists it.
 * `linqChatId` is the external chat identity; `snapshot` is the domain state.
 */
export interface StoredChat {
  linqChatId: string;
  isGroup: boolean;
  snapshot: SessionSnapshot;
  /** Per-user opt-out is chat-independent, tracked as a set of member handles. */
}

/**
 * Persistence seam. The MVP uses the in-memory implementation, keyed by the
 * Linq chat id so the webhook handler can look up a conversation.
 */
export interface SessionStore {
  load(linqChatId: string): Promise<StoredChat | null>;
  save(chat: StoredChat): Promise<void>;
  /**
   * Records an event id as processed, returning false if it was already seen.
   * This is the idempotency gate for at-least-once webhook delivery.
   */
  markEventProcessed(eventId: string, eventType: string): Promise<boolean>;
  /** Opt a member out of all messaging (STOP). Idempotent. */
  setOptedOut(memberHandle: string, optedOut: boolean): Promise<void>;
  isOptedOut(memberHandle: string): Promise<boolean>;
}
