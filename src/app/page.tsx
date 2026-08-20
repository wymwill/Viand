"use client";

import Image from "next/image";
import ChatConsole from "@/components/ChatConsole";
import Reveal from "@/components/Reveal";
import { PhoneCards, PhoneThread, PhoneVote } from "@/components/PhoneMocks";

/**
 * Every way in, in the order they are worth trying.
 *
 * The page used to advertise a phone number, which in a deployment without Linq
 * credentials rendered the placeholder "(555) 555-0123" — a fake number offered
 * as the way in. So each entry here points at something that actually exists:
 * Telegram and Discord are live installs, and Slack is honestly labelled as
 * needing its own app, because there is no hosted Slack workspace to join.
 */
const TELEGRAM_URL = "https://t.me/ViandFoodPickerBot";
const DISCORD_URL =
  "https://discord.com/oauth2/authorize?client_id=1538983395244249170&scope=applications.commands%20bot&permissions=2048";
const SLACK_SETUP_URL = "https://github.com/wymwill/Viand#transports";

const PLATFORMS = [
  { name: "Telegram", href: TELEGRAM_URL, action: "Add on Telegram", note: "Talk normally" },
  { name: "Discord", href: DISCORD_URL, action: "Add on Discord", note: "/eat command" },
  { name: "Slack", href: SLACK_SETUP_URL, action: "Set up in Slack", note: "Self-hosted" },
] as const;

function PlatformChoices({ compact = false }: { compact?: boolean }) {
  return (
    <div className="hero-actions">
      {PLATFORMS.map((platform, index) => (
        <a
          key={platform.name}
          className={`btn ${index === 0 ? "btn-primary" : "btn-ghost"}${compact ? " btn-sm" : ""}`}
          href={platform.href}
        >
          {compact ? platform.name : platform.action}
        </a>
      ))}
    </div>
  );
}

export default function Home() {
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
            <PlatformChoices compact />
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
                everyone’s feeling, and it comes back with a short list — then counts
                the votes so nobody has to.
              </p>

              <PlatformChoices />
              <p className="hero-note">
                <a href="#discovery">See how it works</a>
              </p>

              <p className="hero-note">
                Works in the group chat you already use — no signup.
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
            <span>Works in Telegram, Discord and Slack</span>
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
                  <span>In the Telegram, Discord or Slack group you already argue in.</span>
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
                Five options.
                <br />
                <em>Not five hundred.</em>
              </h2>
              <p className="lead light">
                A search box hands you a list and a brand new problem. Viand hands you
                a shortlist your group can actually agree on — close enough to walk
                to, cheap enough to say yes to, and workable for everyone’s
                restrictions.
              </p>

              <div className="band-cards stagger">
                <article>
                  <h3>At most five</h3>
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
                  <b>Reply with a number</b>
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
              Add Viand to a group and send <strong>/eat</strong>. It works one-on-one,
              and works far better once the whole group is in.
            </p>

            <PlatformChoices />
            <p className="hero-note">
              <a href="#simulator">Or try the demo first</a>
            </p>
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
                <a href={TELEGRAM_URL}>Add on Telegram</a>
              </li>
              <li>
                <a href={DISCORD_URL}>Add on Discord</a>
              </li>
              <li>
                <a href={SLACK_SETUP_URL}>Set up in Slack</a>
              </li>
            </ul>
          </div>

          <div>
            <h4>Good to know</h4>
            <ul>
              <li>Telegram, Discord or Slack</li>
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

    </>
  );
}
