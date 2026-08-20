import { describe, expect, it } from "vitest";
import { parseCommand } from "@/domain/commands";
import { deterministicInterpretation } from "@/domain/interpret/deterministic";
import * as copy from "@/domain/messages/copy";
import { isSplitOnCuisine, type CuisineMediator } from "@/domain/recommendations/mediation";
import { MockRestaurantProvider } from "@/domain/restaurants/mock-provider";
import { advance } from "@/domain/state-machine/engine";
import { initialSnapshot, proposalOutcome, type SessionSnapshot } from "@/domain/state-machine/session";
import { preference } from "../helpers/factories";

const restaurants = new MockRestaurantProvider();

function mediator(proposal: string | null): CuisineMediator {
  return { propose: async () => proposal as never };
}

async function say(
  snapshot: SessionSnapshot,
  memberId: string,
  text: string,
  cuisineMediator?: CuisineMediator,
) {
  return advance({
    snapshot,
    memberId,
    interpretation: deterministicInterpretation({
      text,
      command: parseCommand(text),
      state: snapshot.state,
    }),
    restaurants,
    now: new Date(),
    cuisineMediator,
  });
}

async function splitGroup(cuisineMediator?: CuisineMediator) {
  let snapshot = initialSnapshot(true);
  ({ snapshot } = await say(snapshot, "alice", "Downtown Berkeley"));
  ({ snapshot } = await say(snapshot, "alice", "korean"));
  ({ snapshot } = await say(snapshot, "bob", "italian"));
  return say(snapshot, "alice", "done", cuisineMediator);
}

describe("noticing a split the scorer cannot bridge", () => {
  it("sees a split between cuisines with no family path", () => {
    expect(
      isSplitOnCuisine([
        preference({ preferredCuisines: ["korean"] }),
        preference({ preferredCuisines: ["italian"] }),
      ]),
    ).toBe(true);
  });

  /**
   * Two cuisines in one family already rank well against each other, so asking
   * the group to agree there would spend a model call to change nothing.
   */
  it("does not see a split within one family", () => {
    expect(
      isSplitOnCuisine([
        preference({ preferredCuisines: ["italian"] }),
        preference({ preferredCuisines: ["pizza"] }),
      ]),
    ).toBe(false);
  });

  it("does not see a split when everyone wants the same thing", () => {
    expect(isSplitOnCuisine([preference({ preferredCuisines: ["korean"] })])).toBe(false);
  });
});

describe("a majority carries a proposal", () => {
  const proposal = { cuisine: "japanese" as const, approvedBy: [], rejectedBy: [] };

  it("needs half the members, so one yes among four is not a decision", () => {
    expect(proposalOutcome({ ...proposal, approvedBy: ["a"] }, 4)).toBe("undecided");
    expect(proposalOutcome({ ...proposal, approvedBy: ["a", "b"] }, 4)).toBe("approved");
  });

  it("resolves as soon as enough people have spoken, without waiting for silence", () => {
    // Two of three is a majority; the third never has to answer.
    expect(proposalOutcome({ ...proposal, approvedBy: ["a", "b"] }, 3)).toBe("approved");
  });

  it("rejects on the same threshold", () => {
    expect(proposalOutcome({ ...proposal, rejectedBy: ["a", "b"] }, 3)).toBe("rejected");
  });
});

describe("the proposal in the conversation", () => {
  it("asks the group before showing anything", async () => {
    const { snapshot, replies } = await splitGroup(mediator("japanese"));

    expect(snapshot.state).toBe("AWAITING_CUISINE_APPROVAL");
    expect(snapshot.cuisineProposal?.cuisine).toBe("japanese");
    expect(replies[0]?.text).toContain("Reply YES");
    // The group has not been shown options it did not agree to.
    expect(snapshot.candidates).toHaveLength(0);
  });

  it("ranks with the agreed cuisine once the group approves", async () => {
    let { snapshot } = await splitGroup(mediator("japanese"));
    ({ snapshot } = await say(snapshot, "alice", "yes"));
    ({ snapshot } = await say(snapshot, "bob", "yes"));

    expect(snapshot.agreedCuisine).toBe("japanese");
    expect(snapshot.state).toBe("VOTING");
    expect(snapshot.candidates.length).toBeGreaterThan(0);
  });

  it("shows the split list when the group declines", async () => {
    let { snapshot } = await splitGroup(mediator("japanese"));
    // Half of two is one, so a single no already carries — see below.
    const { snapshot: after, replies } = await say(snapshot, "alice", "no");
    snapshot = after;

    expect(snapshot.agreedCuisine).toBeNull();
    expect(snapshot.state).toBe("VOTING");
    expect(replies.some((r) => r.text.includes(copy.PROPOSAL_REJECTED))).toBe(true);
    expect(snapshot.candidates.length).toBeGreaterThan(0);
  });

  /**
   * Worth stating plainly because it surprises people: "half or more" means one
   * person decides in a group of two. That is the rule working, not a bug —
   * with two members there is no majority that is not also one of them.
   */
  it("lets either member settle it when the group is a pair", async () => {
    const { snapshot } = await splitGroup(mediator("japanese"));
    const { snapshot: after } = await say(snapshot, "alice", "yes");

    expect(after.agreedCuisine).toBe("japanese");
    expect(after.state).toBe("VOTING");
  });

  it("waits for a second voice once the group is three", async () => {
    let snapshot = initialSnapshot(true);
    ({ snapshot } = await say(snapshot, "alice", "Downtown Berkeley"));
    ({ snapshot } = await say(snapshot, "alice", "korean"));
    ({ snapshot } = await say(snapshot, "bob", "italian"));
    ({ snapshot } = await say(snapshot, "carol", "mexican"));
    ({ snapshot } = await say(snapshot, "alice", "done", mediator("japanese")));

    ({ snapshot } = await say(snapshot, "alice", "yes"));
    expect(snapshot.state).toBe("AWAITING_CUISINE_APPROVAL");

    ({ snapshot } = await say(snapshot, "bob", "yes"));
    expect(snapshot.state).toBe("VOTING");
    expect(snapshot.agreedCuisine).toBe("japanese");
  });

  it("keeps what each member actually said, whatever the group agrees", async () => {
    let { snapshot } = await splitGroup(mediator("japanese"));
    ({ snapshot } = await say(snapshot, "alice", "yes"));
    ({ snapshot } = await say(snapshot, "bob", "yes"));

    // An agreed cuisine is applied when ranking, never written back over a
    // member's stated preference — CHANGE later must still mean what they meant.
    expect(snapshot.preferences.alice?.preferredCuisines).toEqual(["korean"]);
    expect(snapshot.preferences.bob?.preferredCuisines).toEqual(["italian"]);
  });

  it("answers anything that is not yes or no by restating the question", async () => {
    let { snapshot } = await splitGroup(mediator("japanese"));
    let replies;
    ({ snapshot, replies } = await say(snapshot, "alice", "what about tacos"));

    expect(snapshot.state).toBe("AWAITING_CUISINE_APPROVAL");
    expect(replies[0]?.text).toContain("YES or NO");
  });
});

describe("when no compromise is available", () => {
  it("behaves exactly as before with no mediator at all", async () => {
    const { snapshot } = await splitGroup(undefined);

    expect(snapshot.state).toBe("VOTING");
    expect(snapshot.candidates.length).toBeGreaterThan(0);
  });

  it("behaves exactly as before when the model declines", async () => {
    const { snapshot } = await splitGroup(mediator(null));

    expect(snapshot.state).toBe("VOTING");
    expect(snapshot.candidates.length).toBeGreaterThan(0);
  });

  it("ignores a proposal nothing nearby actually serves", async () => {
    // Suggesting something unavailable would interrupt the group to ask about
    // a restaurant that does not exist.
    const { snapshot } = await splitGroup(mediator("ethiopian_nonexistent" as never));

    expect(snapshot.state).toBe("VOTING");
  });

  it("survives a mediator that throws", async () => {
    const throwing: CuisineMediator = {
      propose: async () => {
        throw new Error("model down");
      },
    };
    const { snapshot } = await splitGroup(throwing);

    expect(snapshot.state).toBe("VOTING");
    expect(snapshot.candidates.length).toBeGreaterThan(0);
  });
});
