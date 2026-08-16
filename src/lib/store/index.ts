import { getEnv, type Env } from "../env";
import { InMemorySessionStore } from "./memory-store";
import { RedisSessionStore } from "./redis-store";
import { UpstashRestTransport } from "./redis-transport";
import type { SessionStore } from "./types";

export type SessionStoreBackend = "memory" | "redis";

export function resolveSessionStoreBackend(env: Env): SessionStoreBackend {
  return env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? "redis" : "memory";
}

/** Called once while constructing the cached live Runtime, so no store-level singleton is needed. */
export function getSessionStore(): SessionStore {
  switch (resolveSessionStoreBackend(getEnv())) {
    case "redis": return new RedisSessionStore(new UpstashRestTransport());
    case "memory": return new InMemorySessionStore();
  }
}
