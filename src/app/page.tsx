"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { LinqStatus } from "@/app/api/linq/status/route";

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

export default function Dashboard() {
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
  const [connection, setConnection] = useState<LinqStatus>({
    mode: "demo",
    label: "CHECKING LINQ",
    phoneNumber: null,
    phoneDisplay: "Checking connection…",
    lineHealth: null,
  });

  useEffect(() => {
    void fetch("/api/linq/status", { cache: "no-store" })
      .then((response) => response.json() as Promise<LinqStatus>)
      .then(setConnection)
      .catch(() =>
        setConnection({
          mode: "error",
          label: "LINQ UNREACHABLE",
          phoneNumber: null,
          phoneDisplay: "Check server configuration",
          lineHealth: null,
        }),
      );
  }, []);

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
    <>
      <a className="skip-link" href="#simulator">Skip to simulator</a>
      <main>
        <header className="topbar">
          <a className="brand" href="#" aria-label="Viand home">
            <span className="brand-mark">
              <Image src="/brand/viand-logo.png" alt="" width={38} height={38} priority />
            </span>
            <span>VIAND</span>
          </a>
          <span className={`connection ${connection.mode}`}>
            <i /> {connection.label}
          </span>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">MESSAGE IN. DINNER OUT.</p>
            <h1>Stop debating.<br /><em>Pick a place.</em></h1>
            <p className="lede">
              One tiny bot for the group chat. It gathers the area, reads everyone’s
              preferences, and returns three options worth voting on.
            </p>
            <div className="imessage-action">
              {connection.mode === "connected" && connection.phoneNumber ? (
                <a href={`sms:${connection.phoneNumber}?body=EAT`}>
                  OPEN IN MESSAGES ↗
                </a>
              ) : (
                <a href="#connection-guide">CONNECT LINQ ↘</a>
              )}
              <span>
                {connection.phoneDisplay}
                {connection.lineHealth ? ` · ${connection.lineHealth}` : ""}
              </span>
            </div>
            <div className="flow" aria-label="How Viand works">
              <span><b>01</b> TEXT</span>
              <span><b>02</b> FILTER</span>
              <span><b>03</b> PICK</span>
            </div>
          </div>

          <section className="console" id="simulator" aria-labelledby="console-title">
            <div className="console-head">
              <div>
                <p>LIVE MVP</p>
                <h2 id="console-title">Conversation simulator</h2>
              </div>
              <span className="pulse">● ACTIVE</span>
            </div>

            <div className="status-grid">
              <div><span>STATE</span><strong>{state.replaceAll("_", " ")}</strong></div>
              <div><span>AREA</span><strong>{location ?? "WAITING"}</strong></div>
              <div><span>STORE</span><strong>IN MEMORY</strong></div>
            </div>

            <div className="thread" aria-live="polite">
              {lines.map((line) => (
                <div className={`message ${line.from}`} key={line.id}>
                  <span>
                    {line.from === "bot" ? (
                      <Image src="/brand/viand-logo.png" alt="" width={24} height={24} />
                    ) : "YOU"}
                  </span>
                  <p>{line.text}</p>
                </div>
              ))}
              {sending && <div className="typing" aria-label="Viand is replying">•••</div>}
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
                  SEND ↗
                </button>
              </div>
            </form>
          </section>
        </section>

        <section className="connection-guide" id="connection-guide" aria-labelledby="connection-title">
          <div>
            <p className="eyebrow">LIVE CONNECTION</p>
            <h2 id="connection-title">Bring your Linq number.</h2>
          </div>
          <ol>
            <li><b>01</b><span>Add your API key and provisioned number to <code>.env.local</code>.</span></li>
            <li><b>02</b><span>Set <code>APP_BASE_URL</code> to a public HTTPS URL and run <code>npm run linq:register-webhook</code>.</span></li>
            <li><b>03</b><span>Save the returned webhook secret, set <code>USE_MOCK_LINQ=false</code>, and restart.</span></li>
          </ol>
          <p className="endpoint">POST /api/webhooks/linq?version=2026-02-03</p>
        </section>

        <footer>
          <p>LINQ WEBHOOK → MESSAGE ENGINE → LOCAL RECOMMENDATIONS</p>
          <p>NO DATABASE · PROCESS RESTARTS CLEAR STATE</p>
        </footer>
      </main>
    </>
  );
}
