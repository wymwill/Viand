import { describe, expect, it } from "vitest";
import type { Candidate } from "@/domain/recommendations/select";
import type { GroupScore } from "@/domain/recommendations/scoring";
import {
  allActiveMembersVoted,
  canForceClose,
  tally,
  voterCount,
  type Ballot,
} from "@/domain/voting/tally";
import { restaurant } from "../helpers/factories";

function score(total: number): GroupScore {
  return {
    total,
    weakestMember: total,
    averageMember: total,
    cuisineMatch: total,
    distance: total,
    rating: total,
    priceMatch: total,
  };
}

function candidate(id: string, total: number, distanceMiles = 1): Candidate {
  return {
    restaurant: restaurant({ id, name: id, distanceMiles }),
    score: score(total),
    explanation: `${id} explanation.`,
  };
}

const options = [candidate("a", 0.9), candidate("b", 0.8), candidate("c", 0.7)];

function vote(memberId: string, candidateId: string): Ballot {
  return { memberId, candidateId, veto: false };
}

function veto(memberId: string, candidateId: string): Ballot {
  return { memberId, candidateId, veto: true };
}

describe("tally", () => {
  it("counts one vote per member and picks the most-voted option", () => {
    const result = tally(options, [vote("m1", "b"), vote("m2", "b"), vote("m3", "a")]);
    expect(result.winner?.candidate.restaurant.id).toBe("b");
    expect(result.winner?.votes).toBe(2);
    expect(result.runnerUp?.candidate.restaurant.id).toBe("a");
  });

  it("lets a member change their vote", () => {
    const result = tally(options, [vote("m1", "a"), vote("m2", "a"), vote("m1", "c"), vote("m3", "c")]);
    expect(result.winner?.candidate.restaurant.id).toBe("c");
    expect(result.winner?.votes).toBe(2);
    expect(voterCount([vote("m1", "a"), vote("m1", "c")])).toBe(1);
  });

  it("eliminates a vetoed option even when it leads on votes", () => {
    const result = tally(options, [
      vote("m1", "a"),
      vote("m2", "a"),
      vote("m3", "b"),
      veto("m4", "a"),
    ]);
    expect(result.winner?.candidate.restaurant.id).toBe("b");
    expect(result.standings.find((s) => s.candidate.restaurant.id === "a")?.eliminated).toBe(true);
  });

  it("ranks by fewest vetoes when every option is vetoed", () => {
    const result = tally(options, [
      veto("m1", "a"),
      veto("m2", "a"),
      veto("m3", "b"),
      veto("m4", "c"),
      vote("m5", "a"),
    ]);
    expect(result.allOptionsVetoed).toBe(true);
    // b and c each have one veto; b wins on the higher group score.
    expect(result.winner?.candidate.restaurant.id).toBe("b");
  });

  it("breaks a vote tie on group-compatibility score", () => {
    const result = tally(options, [vote("m1", "a"), vote("m2", "c")]);
    expect(result.winner?.candidate.restaurant.id).toBe("a");
  });

  it("breaks a score tie on shortest distance", () => {
    const tied = [candidate("far", 0.8, 3.0), candidate("near", 0.8, 0.5)];
    const result = tally(tied, [vote("m1", "far"), vote("m2", "near")]);
    expect(result.winner?.candidate.restaurant.id).toBe("near");
  });

  it("drops a member's vote when they later veto the same option", () => {
    const result = tally(options, [vote("m1", "a"), veto("m1", "a"), vote("m2", "b")]);
    expect(result.winner?.candidate.restaurant.id).toBe("b");
    expect(result.standings.find((s) => s.candidate.restaurant.id === "a")?.votes).toBe(0);
  });

  it("returns no winner when there are no options", () => {
    expect(tally([], []).winner).toBeNull();
  });

  it("still produces a winner when nobody voted", () => {
    const result = tally(options, []);
    expect(result.winner?.candidate.restaurant.id).toBe("a");
  });
});

describe("voting completion", () => {
  it("is complete once every active member has voted", () => {
    const ballots = [vote("m1", "a"), vote("m2", "b")];
    expect(allActiveMembersVoted(["m1", "m2"], ballots)).toBe(true);
    expect(allActiveMembersVoted(["m1", "m2", "m3"], ballots)).toBe(false);
  });

  it("ignores members who never spoke", () => {
    // m3 is on the roster but never participated, so they are not in the
    // active list and cannot stall the group.
    expect(allActiveMembersVoted(["m1"], [vote("m1", "a")])).toBe(true);
  });

  it("is never complete with no active members", () => {
    expect(allActiveMembersVoted([], [])).toBe(false);
  });

  it("allows a forced close only after two votes", () => {
    expect(canForceClose([vote("m1", "a")])).toBe(false);
    expect(canForceClose([vote("m1", "a"), vote("m2", "b")])).toBe(true);
    // Two ballots from one member is still one voter.
    expect(canForceClose([vote("m1", "a"), vote("m1", "b")])).toBe(false);
  });
});
