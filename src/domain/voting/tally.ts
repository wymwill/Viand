import type { Candidate } from "../recommendations/select";

export interface Ballot {
  /** Stable member identity — the Linq participant handle in production. */
  memberId: string;
  /** Restaurant id of the option this ballot refers to. */
  candidateId: string;
  veto: boolean;
}

export interface Standing {
  candidate: Candidate;
  votes: number;
  vetoes: number;
  /** Removed because someone vetoed it and a non-vetoed option survived. */
  eliminated: boolean;
}

export interface TallyResult {
  standings: Standing[];
  winner: Standing | null;
  runnerUp: Standing | null;
  /** True when every option was vetoed and vetoes had to be ranked instead. */
  allOptionsVetoed: boolean;
}

/**
 * Collapses a member's ballots to at most one vote plus any number of vetoes.
 * Later ballots replace earlier ones, which is how "change my vote" works: the
 * caller appends and the tally honours the last entry.
 */
function normalizeBallots(ballots: readonly Ballot[]): {
  votes: Map<string, string>;
  vetoes: Map<string, Set<string>>;
} {
  const votes = new Map<string, string>();
  const vetoes = new Map<string, Set<string>>();

  for (const ballot of ballots) {
    if (ballot.veto) {
      const existing = vetoes.get(ballot.memberId) ?? new Set<string>();
      existing.add(ballot.candidateId);
      vetoes.set(ballot.memberId, existing);
      // A member cannot both veto and vote for the same option.
      if (votes.get(ballot.memberId) === ballot.candidateId) votes.delete(ballot.memberId);
    } else {
      votes.set(ballot.memberId, ballot.candidateId);
      vetoes.get(ballot.memberId)?.delete(ballot.candidateId);
    }
  }

  return { votes, vetoes };
}

/**
 * Tie-break order from the spec: fewest vetoes, then most votes, then highest
 * group-compatibility score, then shortest distance.
 *
 * A veto is a hard restriction, so a vetoed option is eliminated outright while
 * any un-vetoed option survives. "Fewest vetoes" therefore only decides the
 * outcome in the degenerate case where every option was vetoed — which is the
 * only reading under which both spec rules hold at once.
 */
export function tally(candidates: readonly Candidate[], ballots: readonly Ballot[]): TallyResult {
  const { votes, vetoes } = normalizeBallots(ballots);

  const voteCounts = new Map<string, number>();
  for (const candidateId of votes.values()) {
    voteCounts.set(candidateId, (voteCounts.get(candidateId) ?? 0) + 1);
  }

  const vetoCounts = new Map<string, number>();
  for (const vetoedIds of vetoes.values()) {
    for (const candidateId of vetoedIds) {
      vetoCounts.set(candidateId, (vetoCounts.get(candidateId) ?? 0) + 1);
    }
  }

  const survivorsExist = candidates.some(
    (candidate) => (vetoCounts.get(candidate.restaurant.id) ?? 0) === 0,
  );

  const standings: Standing[] = candidates.map((candidate) => {
    const vetoCount = vetoCounts.get(candidate.restaurant.id) ?? 0;
    return {
      candidate,
      votes: voteCounts.get(candidate.restaurant.id) ?? 0,
      vetoes: vetoCount,
      eliminated: survivorsExist && vetoCount > 0,
    };
  });

  standings.sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    if (a.vetoes !== b.vetoes) return a.vetoes - b.vetoes;
    if (a.votes !== b.votes) return b.votes - a.votes;
    if (a.candidate.score.total !== b.candidate.score.total) {
      return b.candidate.score.total - a.candidate.score.total;
    }
    return a.candidate.restaurant.distanceMiles - b.candidate.restaurant.distanceMiles;
  });

  const eligible = standings.filter((standing) => !standing.eliminated);
  const ranked = eligible.length > 0 ? eligible : standings;

  return {
    standings,
    winner: ranked[0] ?? null,
    runnerUp: ranked[1] ?? null,
    allOptionsVetoed: !survivorsExist && candidates.length > 0,
  };
}

/** Number of distinct members who cast a non-veto vote. */
export function voterCount(ballots: readonly Ballot[]): number {
  return normalizeBallots(ballots).votes.size;
}

/**
 * Voting completes when every member we know to be participating has voted, or
 * when someone sends DONE with at least two votes in. Members who never spoke
 * are not counted — a lurker must never be able to stall the group forever.
 */
export function allActiveMembersVoted(
  activeMemberIds: readonly string[],
  ballots: readonly Ballot[],
): boolean {
  if (activeMemberIds.length === 0) return false;
  const { votes } = normalizeBallots(ballots);
  return activeMemberIds.every((memberId) => votes.has(memberId));
}

export const MIN_VOTES_TO_FORCE_CLOSE = 2;

export function canForceClose(ballots: readonly Ballot[]): boolean {
  return voterCount(ballots) >= MIN_VOTES_TO_FORCE_CLOSE;
}
