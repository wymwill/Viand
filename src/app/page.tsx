"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { ViandNumber } from "@/app/api/number/route";
import ChatConsole from "@/components/ChatConsole";
import NumberDialog from "@/components/NumberDialog";
import Reveal from "@/components/Reveal";
import { PhoneCards, PhoneThread, PhoneVote } from "@/components/PhoneMocks";

export default function Home() {
  const [number, setNumber] = useState<ViandNumber>({
    display: "(555) 555-0123",
    e164: "+15555550123",
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/number", { cache: "no-store" })
      .then((response) => response.json() as Promise<ViandNumber>)
      .then(setNumber)
      .catch(() => {
        /* Keep the configured fallback already in state. */
      });
  }, []);

  const openDialog = () => setDialogOpen(true);

  return (
    <>
      <a className="skip-link" href="#simulator">
        Skip to the live demo
      </a>

      <header className="site-nav">
        <div className="wrap nav-inner">
          <a className="wordmark" href="#top" aria-label="Viand home">
            <Image src="/brand/viand-icon.png" alt="" width={30} height={30} priority />
            <span>Viand</span>
          </a>

          <nav className="nav-links" aria-label="Primary">
            <a href="#simulator">Live demo</a>
            <a href="#discovery">How it works</a>
            <a href="#lounge">Voting</a>
          </nav>

          <div className="nav-end">
            <span className="nav-number">{number.display}</span>
            <button className="btn btn-primary btn-sm" type="button" onClick={openDialog}>
              Text Viand
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* ---------- Hero: copy left, live demo right ---------- */}
        <section className="hero">
          <span className="orb orb-a" aria-hidden="true" />
          <span className="orb orb-b" aria-hidden="true" />

          <div className="wrap hero-inner">
            <Reveal className="hero-copy">
              <p className="eyebrow">Message in · dinner out</p>
              <h1 className="display">
                Find where to eat,
                <br />
                <em>together.</em>
              </h1>
              <p className="lede">
                Viand sits in your group chat. Tell it roughly where you are and what
                everyone’s feeling, and it comes back with three spots — then counts
                the votes so nobody has to.
              </p>

              <div className="hero-actions">
                <button className="btn btn-primary" type="button" onClick={openDialog}>
                  Text Viand
                </button>
                <a className="btn btn-ghost" href="#discovery">
                  See how it works
                </a>
              </div>

              <p className="hero-note">
                Text <strong>{number.display}</strong> — no app, no signup.
              </p>

              <ol className="flow" aria-label="How Viand works">
                <li>
                  <b>01</b> Text
                </li>
                <li>
                  <b>02</b> Filter
                </li>
                <li>
                  <b>03</b> Pick
                </li>
              </ol>
            </Reveal>

            <Reveal className="hero-console" delay={140}>
              <ChatConsole />
            </Reveal>
          </div>
        </section>

        {/* ---------- Full-bleed atmospheric moment ---------- */}
        <section className="plate" aria-labelledby="plate-title">
          <Image
            className="plate-img"
            src="/img/table.jpg"
            alt="An overhead view of a shared table: pasta, a tomato and burrata salad, torn bread, and glasses of white wine in afternoon light."
            fill
            sizes="100vw"
          />
          <span className="plate-veil" aria-hidden="true" />
          <Reveal className="wrap plate-copy">
            <p className="eyebrow light">The table</p>
            <p className="pull" id="plate-title">
              Nobody wants to plan dinner.
              <br />
              Everybody wants to be at it.
            </p>
          </Reveal>
        </section>

        {/* ---------- What it actually runs on ---------- */}
        <section className="trust">
          <Reveal className="wrap trust-inner stagger">
            <span>Real places from OpenStreetMap</span>
            <span>Works in iMessage</span>
            <span>Reads plain English</span>
            <span>Nothing to install</span>
          </Reveal>
        </section>

        {/* ---------- Feature: discovery ---------- */}
        <section className="feature" id="discovery">
          <div className="wrap feature-grid">
            <Reveal className="feature-media">
              <PhoneThread />
            </Reveal>

            <Reveal className="feature-copy" delay={120}>
              <p className="eyebrow">How it works</p>
              <h2 className="section-title">It lives where the arguing happens.</h2>
              <p className="lead">
                No app, no link, no third tab. Viand just answers in the thread you’re
                already ignoring each other in — and it only asks the two questions
                that actually narrow things down.
              </p>

              <ul className="checklist">
                <li>
                  <b>Right in your thread</b>
                  <span>A real iMessage number, not a bot account or an invite link.</span>
                </li>
                <li>
                  <b>Just talk normally</b>
                  <span>
                    “Mexican, under $25, one of us is vegetarian” is a perfectly good
                    answer.
                  </span>
                </li>
                <li>
                  <b>Real places, real walking distance</b>
                  <span>Everything comes from live map data around wherever you said.</span>
                </li>
              </ul>
            </Reveal>
          </div>
        </section>

        {/* ---------- Dark band: curation ---------- */}
        <section className="band">
          <div className="wrap feature-grid">
            <Reveal className="feature-copy">
              <p className="eyebrow light">The shortlist</p>
              <h2 className="section-title light">
                Three options.
                <br />
                <em>Not three hundred.</em>
              </h2>
              <p className="lead light">
                A search box hands you a list and a brand new problem. Viand hands you
                a shortlist your group can actually agree on — close enough to walk
                to, cheap enough to say yes to, open when you want it.
              </p>

              <div className="band-cards stagger">
                <article>
                  <h3>Always three</h3>
                  <p>Short enough that the thread lands on one instead of scrolling.</p>
                </article>
                <article>
                  <h3>Everyone’s stuff counts</h3>
                  <p>One vegetarian and a $25 ceiling are filters, not footnotes.</p>
                </article>
              </div>
            </Reveal>

            <Reveal className="feature-media" delay={120}>
              <PhoneCards />
            </Reveal>
          </div>
        </section>

        {/* ---------- Feature: voting ---------- */}
        <section className="feature" id="lounge">
          <div className="wrap feature-grid">
            <Reveal className="feature-media">
              <PhoneVote />
            </Reveal>

            <Reveal className="feature-copy" delay={120}>
              <p className="eyebrow">Voting</p>
              <h2 className="section-title">The vote settles it.</h2>
              <p className="lead">
                Everybody replies with a number. Viand keeps score as the answers land
                and calls it once the room has spoken — no spreadsheet, and nobody
                stuck deciding for five people.
              </p>

              <ul className="checklist">
                <li>
                  <b>Reply 1, 2, or 3</b>
                  <span>That’s the whole interface. One digit.</span>
                </li>
                <li>
                  <b>Counted as they come in</b>
                  <span>The tally updates right in the thread.</span>
                </li>
              </ul>
            </Reveal>
          </div>
        </section>

        {/* ---------- Closing call to action ---------- */}
        <section className="closer" id="text-viand">
          <Reveal className="wrap closer-inner">
            <p className="eyebrow">Ready when you are</p>
            <h2 className="section-title">Hungry now?</h2>
            <p className="lead">
              Text Viand and it takes it from there. Works one-on-one, and works even
              better once it’s in the group chat.
            </p>

            <button className="closer-number" type="button" onClick={openDialog}>
              {number.display}
            </button>

            <div className="hero-actions">
              <button className="btn btn-primary" type="button" onClick={openDialog}>
                Text Viand
              </button>
              <a className="btn btn-ghost" href="#simulator">
                Try the demo first
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap footer-grid">
          <div className="footer-brand">
            <span className="wordmark static">
              <Image src="/brand/viand-icon.png" alt="" width={28} height={28} />
              <span>Viand</span>
            </span>
            <p>Message in, dinner out. An easier way for a group to land on a table.</p>
          </div>

          <div>
            <h4>On this page</h4>
            <ul>
              <li>
                <a href="#simulator">Live demo</a>
              </li>
              <li>
                <a href="#discovery">How it works</a>
              </li>
              <li>
                <a href="#lounge">Voting</a>
              </li>
              <li>
                <a href="#text-viand">Text Viand</a>
              </li>
            </ul>
          </div>

          <div>
            <h4>Good to know</h4>
            <ul>
              <li>Text {number.display}</li>
              <li>Restaurants from OpenStreetMap</li>
              <li>Nothing to download</li>
            </ul>
          </div>
        </div>

        <div className="wrap footer-base">
          <p>© {new Date().getFullYear()} Viand</p>
          <p>Built on OpenStreetMap</p>
        </div>
      </footer>

      <NumberDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        display={number.display}
        e164={number.e164}
      />
    </>
  );
}
