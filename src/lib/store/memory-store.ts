import type { SessionStore, StoredChat } from "./types";

/**
 * Process-local store. Everything the product needs to run end to end lives
 * here, so the simulator and the full test suite need no database. State is lost
 * on restart by design for this MVP.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly chats = new Map<string, StoredChat>();
  private readonly processedEvents = new Set<string>();
  private readonly optedOut = new Set<string>();
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  async incrementCounter(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.counters.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  async load(linqChatId: string): Promise<StoredChat | null> {
    return this.chats.get(linqChatId) ?? null;
  }

  async save(chat: StoredChat): Promise<void> {
    this.chats.set(chat.linqChatId, chat);
  }

  async markEventProcessed(eventId: string): Promise<boolean> {
    if (this.processedEvents.has(eventId)) return false;
    this.processedEvents.add(eventId);
    return true;
  }

  async setOptedOut(memberHandle: string, optedOut: boolean): Promise<void> {
    if (optedOut) this.optedOut.add(memberHandle);
    else this.optedOut.delete(memberHandle);
  }

  async isOptedOut(memberHandle: string): Promise<boolean> {
    return this.optedOut.has(memberHandle);
  }

  /** Test/simulator helper: wipe everything. */
  reset(): void {
    this.chats.clear();
    this.processedEvents.clear();
    this.optedOut.clear();
  }
}
