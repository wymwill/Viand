import { describe, expect, it } from "vitest";
import { advance } from "@/domain/state-machine/engine";
import { initialSnapshot, type SessionSnapshot } from "@/domain/state-machine/session";
import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";

const restaurants = new MockRestaurantProvider();

async function say(snapshot: SessionSnapshot, memberId: string, text: string) {
  return advance({ snapshot, memberId, text, restaurants });
}

describe("full group decision flow", () => {
  it("runs location -> preferences -> recommend -> vote -> winner", async () => {
    let snapshot = initialSnapshot(true);

    // Location
    ({ snapshot } = await say(snapshot, "alice", "Downtown Berkeley"));
    expect(snapshot.state).toBe("COLLECTING_PREFERENCES");

    // Preferences from three members
    ({ snapshot } = await say(snapshot, "alice", "Mexican or Korean, under $25"));
    ({ snapshot } = await say(snapshot, "bob", "Vegetarian, within 15 minutes"));
    ({ snapshot } = await say(snapshot, "carol", "Anything except seafood"));
    expect(Object.keys(snapshot.preferences)).toHaveLength(3);

    // Close preferences -> recommendation
    const recommended = await say(snapshot, "alice", "done");
    snapshot = recommended.snapshot;
    expect(snapshot.state).toBe("VOTING");
    expect(snapshot.candidates).toHaveLength(3);
    const optionsMessage = recommended.replies.at(-1)?.text ?? "";
    expect(optionsMessage).toContain("I found three options");
    // The chat-opening options message must not contain a directions URL.
    expect(optionsMessage).not.toContain("http");

    // Voting
    ({ snapshot } = await say(snapshot, "alice", "1"));
    ({ snapshot } = await say(snapshot, "bob", "1"));
    const closed = await say(snapshot, "carol", "2");
    snapshot = closed.snapshot;

    // All three active members voted -> completed automatically.
    expect(snapshot.state).toBe("COMPLETED");
    const winnerMessage = closed.replies.at(-1);
    expect(winnerMessage?.text).toMatch(/wins|it is/);
    expect(winnerMessage?.text).toContain("Directions:");
    // The winner message carries a link, so it is flagged for a follow-up send.
    expect(winnerMessage?.deferLink).toBe(true);
  });

  it("closes voting early on DONE after two votes", async () => {
    let snapshot = initialSnapshot(true);
    ({ snapshot } = await say(snapshot, "alice", "Berkeley"));
    ({ snapshot } = await say(snapshot, "alice", "pizza"));
    ({ snapshot } = await say(snapshot, "bob", "anything"));
    ({ snapshot } = await say(snapshot, "carol", "anything"));
    ({ snapshot } = await say(snapshot, "alice", "done"));
    expect(snapshot.state).toBe("VOTING");

    ({ snapshot } = await say(snapshot, "alice", "1"));
    ({ snapshot } = await say(snapshot, "bob", "2"));
    // carol has not voted, but DONE with two votes in force-closes.
    const closed = await say(snapshot, "alice", "done");
    expect(closed.snapshot.state).toBe("COMPLETED");
  });

  it("returns to preferences when restrictions eliminate every option", async () => {
    let snapshot = initialSnapshot(true);
    ({ snapshot } = await say(snapshot, "alice", "Berkeley"));
    // Impossible combination: vegan, $ only, within a tenth of a mile.
    ({ snapshot } = await say(snapshot, "alice", "vegan, under $10, within 0.1 miles"));
    const result = await say(snapshot, "alice", "done");
    expect(result.snapshot.state).toBe("COLLECTING_PREFERENCES");
    expect(result.replies.at(-1)?.text).toContain("couldn't find");
  });

  it("applies a veto so the vetoed option cannot win", async () => {
    let snapshot = initialSnapshot(true);
    ({ snapshot } = await say(snapshot, "alice", "Berkeley"));
    ({ snapshot } = await say(snapshot, "alice", "anything"));
    ({ snapshot } = await say(snapshot, "bob", "anything"));
    ({ snapshot } = await say(snapshot, "alice", "done"));

    const topOption = snapshot.candidates[0]?.restaurant.name;
    ({ snapshot } = await say(snapshot, "alice", "veto 1"));
    ({ snapshot } = await say(snapshot, "alice", "2"));
    const closed = await say(snapshot, "bob", "2");
    expect(closed.snapshot.state).toBe("COMPLETED");
    expect(closed.replies.at(-1)?.text).not.toContain(`${topOption} wins`);
  });
});
