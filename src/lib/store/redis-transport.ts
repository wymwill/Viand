import { getEnv } from "../env";

export interface RedisTransport {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
}

type UpstashResponse = { result?: unknown; error?: string };

/** Minimal Redis client for Upstash's stateless REST command endpoint. */
export class UpstashRestTransport implements RedisTransport {
  private readonly url: string;
  private readonly token: string;

  constructor(url?: string, token?: string) {
    const env = getEnv();
    this.url = url ?? env.UPSTASH_REDIS_REST_URL ?? "";
    this.token = token ?? env.UPSTASH_REDIS_REST_TOKEN ?? "";
    if (!this.url || !this.token) {
      throw new Error(
        "UpstashRestTransport requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN",
      );
    }
  }

  async get(key: string): Promise<string | null> {
    const result = await this.command(["GET", key]);
    if (result !== null && typeof result !== "string") {
      throw new Error("Upstash Redis GET returned an unexpected result");
    }
    return result;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.command(["SET", key, value, ...(ttlSeconds === undefined ? [] : ["EX", String(ttlSeconds)])]);
  }

  async setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return (await this.command(["SET", key, value, "NX", "EX", String(ttlSeconds)])) === "OK";
  }

  async del(key: string): Promise<void> {
    await this.command(["DEL", key]);
  }

  private async command(command: string[]): Promise<unknown> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      // Five seconds prevents a Redis outage from tying up a serverless request.
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Upstash Redis request failed (${response.status}): ${body}`);

    let parsed: UpstashResponse;
    try {
      parsed = JSON.parse(body) as UpstashResponse;
    } catch {
      throw new Error(`Upstash Redis returned invalid JSON: ${body}`);
    }
    if (parsed.error) throw new Error(`Upstash Redis error: ${parsed.error}`);
    return parsed.result;
  }
}
