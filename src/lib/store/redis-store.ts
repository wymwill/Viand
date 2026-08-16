import type { RedisTransport } from "./redis-transport";
import type { SessionStore, StoredChat } from "./types";

// Webhook retries normally last minutes or low hours; 24 hours is cheap,
// bounded insurance that comfortably covers any plausible retry window.
const EVENT_TTL_SECONDS = 24 * 60 * 60;

// Six hours outlives a slow-moving evening decision without retaining abandoned
// sessions forever. Every save refreshes it, so active conversations stay alive.
const SESSION_TTL_SECONDS = 6 * 60 * 60;

/**
 * Durable session storage. Errors deliberately propagate (fail closed): the
 * conversation service performs event dedup before mutation or sending, and
 * webhook routes turn the error into a retryable 5xx. Falling back to a local
 * Map would split state across serverless instances and create contradictory
 * conversations instead of merely delaying a reply until Redis recovers.
 */
export class RedisSessionStore implements SessionStore {
  constructor(private readonly transport: RedisTransport) {}

  async load(linqChatId: string): Promise<StoredChat | null> {
    const value = await this.transport.get(`viand:session:${linqChatId}`);
    return value === null ? null : (JSON.parse(value) as StoredChat);
  }

  async save(chat: StoredChat): Promise<void> {
    // Last-write-wins is intentional. A request's load→advance→save is
    // sequential; only two different members arriving in a narrow concurrent
    // window can race. Plain SET is supported by stateless REST without adding
    // domain revisions/Lua CAS, and a lost update self-heals on the next message
    // when the state machine advances from the snapshot currently stored.
    await this.transport.set(`viand:session:${chat.linqChatId}`, JSON.stringify(chat), SESSION_TTL_SECONDS);
  }

  async markEventProcessed(eventId: string, eventType: string): Promise<boolean> {
    return this.transport.setIfNotExists(`viand:event:${eventId}`, eventType, EVENT_TTL_SECONDS);
  }

  async setOptedOut(memberHandle: string, optedOut: boolean): Promise<void> {
    const key = `viand:optout:${memberHandle}`;
    // Compliance-shaped STOP state is permanent until explicit START, matching
    // the in-memory implementation rather than behaving like a cache.
    if (optedOut) await this.transport.set(key, "1");
    else await this.transport.del(key);
  }

  async isOptedOut(memberHandle: string): Promise<boolean> {
    return (await this.transport.get(`viand:optout:${memberHandle}`)) !== null;
  }
}
