import type { ReactNode } from "react";

/**
 * Hand-built phone screens for the marketing sections. These are markup rather
 * than screenshots so they stay crisp at any resolution and always match the
 * copy sitting next to them.
 */
function PhoneShell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="phone" role="img" aria-label={label}>
      <div className="phone-screen" aria-hidden="true">
        <span className="phone-notch" />
        {children}
      </div>
    </div>
  );
}

export function PhoneThread() {
  return (
    <PhoneShell label="A group chat thread in which Viand asks for an area, then for constraints, then confirms nearby options.">
      <div className="phone-bar">
        <span className="phone-avatar" />
        <div>
          <strong>Viand</strong>
          <small>Group chat</small>
        </div>
      </div>
      <div className="phone-body">
        <p className="bubble out">Hey Viand</p>
        <p className="bubble in">On it. What area are we in?</p>
        <p className="bubble out">Downtown Berkeley</p>
        <p className="bubble in">Anything I should filter for?</p>
        <p className="bubble out">Mexican, under $25, one vegetarian</p>
        <p className="bubble in">Three places within a nine minute walk. Sending them now.</p>
      </div>
    </PhoneShell>
  );
}

export function PhoneCards() {
  return (
    <PhoneShell label="Three restaurant cards showing cuisine, price, walking distance and dietary tags.">
      <div className="phone-bar dark">
        <span className="phone-avatar" />
        <div>
          <strong>Tonight</strong>
          <small>Three options</small>
        </div>
      </div>
      <div className="phone-body cards">
        <article className="rcard">
          <span className="rcard-art art-1" />
          <div className="rcard-body">
            <p className="rcard-name">Comal</p>
            <p className="rcard-meta">Oaxacan · $$ · 6 min walk</p>
            <p className="rcard-tags">
              <span>Vegetarian</span>
              <span>Patio</span>
            </p>
          </div>
        </article>
        <article className="rcard">
          <span className="rcard-art art-2" />
          <div className="rcard-body">
            <p className="rcard-name">Tacos Sinaloa</p>
            <p className="rcard-meta">Taqueria · $ · 9 min walk</p>
            <p className="rcard-tags">
              <span>Late</span>
              <span>Cash</span>
            </p>
          </div>
        </article>
        <article className="rcard">
          <span className="rcard-art art-3" />
          <div className="rcard-body">
            <p className="rcard-name">Agave Uptown</p>
            <p className="rcard-meta">Modern Mexican · $$ · 4 min walk</p>
            <p className="rcard-tags">
              <span>Bar</span>
              <span>Groups</span>
            </p>
          </div>
        </article>

        <p className="phone-hint">Reply 1, 2, or 3 to vote</p>
      </div>
    </PhoneShell>
  );
}

export function PhoneVote() {
  return (
    <PhoneShell label="A live vote tally with three restaurants, showing Comal ahead with three of five votes.">
      <div className="phone-bar">
        <span className="phone-avatar" />
        <div>
          <strong>The Lounge</strong>
          <small>5 in the thread</small>
        </div>
      </div>
      <div className="phone-body vote">
        <p className="vote-title">Reply 1, 2, or 3</p>

        <div className="vote-row leading">
          <div className="vote-head">
            <span className="vote-index">1</span>
            <span className="vote-name">Comal</span>
            <span className="vote-count">3</span>
          </div>
          <span className="vote-bar">
            <i style={{ width: "60%" }} />
          </span>
        </div>

        <div className="vote-row">
          <div className="vote-head">
            <span className="vote-index">2</span>
            <span className="vote-name">Tacos Sinaloa</span>
            <span className="vote-count">1</span>
          </div>
          <span className="vote-bar">
            <i style={{ width: "20%" }} />
          </span>
        </div>

        <div className="vote-row">
          <div className="vote-head">
            <span className="vote-index">3</span>
            <span className="vote-name">Agave Uptown</span>
            <span className="vote-count">1</span>
          </div>
          <span className="vote-bar">
            <i style={{ width: "20%" }} />
          </span>
        </div>

        <p className="vote-result">
          <strong>Comal</strong> takes it. 7:30, six minutes out.
        </p>
      </div>
    </PhoneShell>
  );
}
