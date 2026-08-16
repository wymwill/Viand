import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstashRestTransport } from "@/lib/store/redis-transport";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("UpstashRestTransport", () => {
  it("sends flat Upstash command arrays with authentication", async () => {
    const commands: string[][] = [];
    global.fetch = vi.fn(async (_input, init) => {
      commands.push(JSON.parse(String(init?.body)) as string[]);
      const command = commands.at(-1);
      return response({ result: command?.[0] === "GET" ? "value" : "OK" });
    });
    const transport = new UpstashRestTransport("https://redis.example.com", "secret");
    expect(await transport.get("key")).toBe("value");
    await transport.set("key", "value", 30);
    expect(await transport.setIfNotExists("event", "type", 60)).toBe(true);
    await transport.del("key");
    expect(commands).toEqual([
      ["GET", "key"],
      ["SET", "key", "value", "EX", "30"],
      ["SET", "event", "type", "NX", "EX", "60"],
      ["DEL", "key"],
    ]);
    expect(global.fetch).toHaveBeenCalledWith("https://redis.example.com", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
    }));
  });

  it("maps a null NX result to false", async () => {
    global.fetch = vi.fn(async () => response({ result: null }));
    const transport = new UpstashRestTransport("https://redis.example.com", "secret");
    expect(await transport.setIfNotExists("event", "type", 60)).toBe(false);
  });

  it("throws response details for HTTP and Upstash errors", async () => {
    const transport = new UpstashRestTransport("https://redis.example.com", "secret");
    global.fetch = vi.fn(async () => response({ message: "down" }, 503));
    await expect(transport.get("key")).rejects.toThrow(/503.*down/);
    global.fetch = vi.fn(async () => response({ error: "WRONGTYPE" }));
    await expect(transport.get("key")).rejects.toThrow(/WRONGTYPE/);
  });
});
