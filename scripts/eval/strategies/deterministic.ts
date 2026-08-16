import { recommend } from "@/domain/recommendations/select";
import type { Restaurant } from "@/domain/restaurants/provider";
import type { EvalGroup } from "../generate";

/**
 * Strategy (c): the shipped deterministic scorer, unmodified.
 *
 * It sees the same stated preferences as the other two. What distinguishes it
 * is the hard/soft split from Phase 2.1: `recommend` eliminates on hard
 * constraints before anything is ranked, so it is structurally incapable of
 * returning a restaurant that breaks a stated constraint. When nothing
 * survives it returns no candidates, which the harness records as an
 * abstention rather than a bad pick.
 */
export function deterministicStrategy(group: EvalGroup, catalogue: readonly Restaurant[]): Restaurant | null {
  const preferences = group.members.map((member) => member.stated);
  const result = recommend(catalogue, preferences, { limit: 1 });
  return result.candidates[0]?.restaurant ?? null;
}
