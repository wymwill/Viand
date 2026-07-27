"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type ChatLine = {
  id: string;
  from: "you" | "bot";
  text: string;
};

type SimulationResponse = {
  replies?: string[];
  snapshot?: { state: string; locationText: string | null } | null;
  error?: string;
};

const starterMessages = ["Hey Viand", "Downtown Berkeley", "Mexican under $25", "done"];

/**
 * Browser-side stand-in for the iMessage thread. Posts to the same message
 * engine the Linq webhook uses, so what happens here is what happens in a chat.
 */
export default function ChatConsole() {
  const [message, setMessage] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([
    {
      id: "welcome",
      from: "bot",
      text: "Ready when your group is. Say “Hey Viand” to begin.",
    },
  ]);
  const [state, setState] = useState("IDLE");
  const [location, setLocation] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [lines, sending]);

  const nextHint = useMemo(() => {
    if (state === "IDLE") return "Say “Hey Viand” to begin";
    if (state === "COLLECTING_LOCATION") return "Try a neighborhood, ZIP, or address";
    if (state === "COLLECTING_PREFERENCES") return "Add a cuisine, budget, or dietary need";
    if (state === "VOTING") return "Vote 1, 2, or 3";
    return "Say “Hey Viand” to begin again";
  }, [state]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || sending) return;

    setSending(true);
    setLines((current) => [
      ...current,
      { id: crypto.randomUUID(), from: "you", text: clean },
    ]);
    setMessage("");

    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: clean, chatId: "dashboard-demo", sender: "you" }),
      });
      const data = (await response.json()) as SimulationResponse;
      if (!response.ok) throw new Error(data.error ?? "Message failed");

      setLines((current) => [
        ...current,
        ...(data.replies ?? []).map((reply) => ({
          id: crypto.randomUUID(),
          from: "bot" as const,
          text: reply,
        })),
      ]);
      if (data.snapshot) {
        setState(data.snapshot.state);
        setLocation(data.snapshot.locationText);
      }
    } catch (error) {
      setLines((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          from: "bot",
          text: error instanceof Error ? error.message : "Something went wrong.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(message);
  }

  return (
    <section className="console" id="simulator" aria-labelledby="console-title">
      <div className="console-head">
        <div>
          <p className="console-eyebrow">Live demo</p>
          <h2 id="console-title">Try the thread</h2>
        </div>
        <span className="pulse">
          <i />
          Active
        </span>
      </div>

      <div className="status-grid">
        <div>
          <span>State</span>
          <strong>{state.replaceAll("_", " ").toLowerCase()}</strong>
        </div>
        <div>
          <span>Area</span>
          <strong>{location ?? "Waiting"}</strong>
        </div>
        <div>
          <span>Store</span>
          <strong>In memory</strong>
        </div>
      </div>

      <div className="thread" ref={threadRef} role="log" aria-live="polite">
        {lines.map((line) => (
          <div className={`message ${line.from}`} key={line.id}>
            <span className="avatar">
              {line.from === "bot" ? (
                <Image src="/brand/viand-logo.png" alt="" width={24} height={24} />
              ) : (
                "You"
              )}
            </span>
            <p>{line.text}</p>
          </div>
        ))}
        {sending && (
          <div className="typing" aria-label="Viand is replying">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>

      <div className="quick-actions" aria-label="Example messages">
        {starterMessages.map((starter) => (
          <button key={starter} type="button" onClick={() => void send(starter)}>
            {starter}
          </button>
        ))}
      </div>

      <form onSubmit={submit}>
        <label htmlFor="message">Message</label>
        <div className="composer">
          <input
            id="message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={nextHint}
            disabled={sending}
            autoComplete="off"
          />
          <button type="submit" disabled={sending || !message.trim()}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
