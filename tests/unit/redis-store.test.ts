import { initialSnapshot } from "@/domain/state-machine/session";
import { RedisSessionStore } from "@/lib/store/redis-store";
import type { RedisTransport } from "@/lib/store/redis-transport";
import type { StoredChat } from "@/lib/store/types";
import { describe, expect, it } from "vitest";

class FakeRedisTransport implements RedisTransport {
  readonly values = new Map<string, string>();
  readonly expiresAt = new Map<string, number>();
  now = Date.now();

  private expire(key: string): void {
    const expiry = this.expiresAt.get(key);
    if (expiry !== undefined && expiry <= this.now) {
      this.values.delete(key);
      this.expiresAt.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.expire(key);
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.values.set(key, value);
    if (ttlSeconds === undefined) this.expiresAt.delete(key);
    else this.expiresAt.set(key, this.now + ttlSeconds * 1_000);
  }

  async setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    this.expire(key);
    if (this.values.has(key)) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
    this.expiresAt.delete(key);
  }
}

const chat: StoredChat = {
  linqChatId: "chat-1",
  isGroup: true,
  snapshot: initialSnapshot(true),
};

describe("RedisSessionStore", () => {
  it("round-trips sessions and refreshes their six-hour TTL on save", async () => {
    const transport = new FakeRedisTransport();
    const store = new RedisSessionStore(transport);
    expect(await store.load(chat.linqChatId)).toBeNull();
    await store.save(chat);
    expect(await store.load(chat.linqChatId)).toEqual(chat);
    const firstExpiry = transport.expiresAt.get("viand:session:chat-1");

    transport.now += 60_000;
    await store.save(chat);
    expect(transport.expiresAt.get("viand:session:chat-1")).toBe((firstExpiry ?? 0) + 60_000);
    transport.now += 6 * 60 * 60 * 1_000;
    expect(await store.load(chat.linqChatId)).toBeNull();
  });

  it("atomically deduplicates concurrent event deliveries for 24 hours", async () => {
    const transport = new FakeRedisTransport();
    const store = new RedisSessionStore(transport);
    const results = await Promise.all([
      store.markEventProcessed("event-1", "message.received"),
      store.markEventProcessed("event-1", "message.received"),
    ]);
    expect(results.sort()).toEqual([false, true]);
    transport.now += 24 * 60 * 60 * 1_000;
    expect(await store.markEventProcessed("event-1", "message.received")).toBe(true);
  });

  it("persists opt-out without a TTL and removes it on opt-in", async () => {
    const transport = new FakeRedisTransport();
    const store = new RedisSessionStore(transport);
    await store.setOptedOut("+1555", true);
    expect(await store.isOptedOut("+1555")).toBe(true);
    expect(transport.expiresAt.has("viand:optout:+1555")).toBe(false);
    transport.now += 365 * 24 * 60 * 60 * 1_000;
    expect(await store.isOptedOut("+1555")).toBe(true);
    await store.setOptedOut("+1555", false);
    expect(await store.isOptedOut("+1555")).toBe(false);
  });

  it("propagates transport errors instead of falling back to memory", async () => {
    const failure = new Error("redis unavailable");
    const transport = new FakeRedisTransport();
    transport.get = async () => { throw failure; };
    transport.set = async () => { throw failure; };
    transport.setIfNotExists = async () => { throw failure; };
    transport.del = async () => { throw failure; };
    const store = new RedisSessionStore(transport);
    await expect(store.load("chat")).rejects.toBe(failure);
    await expect(store.save(chat)).rejects.toBe(failure);
    await expect(store.markEventProcessed("event", "type")).rejects.toBe(failure);
    await expect(store.setOptedOut("member", true)).rejects.toBe(failure);
    await expect(store.setOptedOut("member", false)).rejects.toBe(failure);
  });
});
