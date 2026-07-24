import { describe, expect, it } from "vitest";
import { parseCommand } from "@/domain/commands";
import { transition } from "@/domain/state-machine/reducer";
import { initialSnapshot, type InboundEvent, type SessionSnapshot } from "@/domain/state-machine/session";

function event(memberId: string, text: string): InboundEvent {
  return { memberId, command: parseCommand(text), rawText: text };
}

function step(snapshot: SessionSnapshot, memberId: string, text: string): SessionSnapshot {
  return transition(snapshot, event(memberId, text)).snapshot;
}

describe("state transitions", () => {
  it("starts by collecting location", () => {
    expect(initialSnapshot(true).state).toBe("COLLECTING_LOCATION");
  });

  it("moves to preferences once a location is given", () => {
    const result = transition(initialSnapshot(true), event("m1", "Downtown Berkeley"));
    expect(result.snapshot.state).toBe("COLLECTING_PREFERENCES");
    expect(result.snapshot.locationText).toBe("Downtown Berkeley");
    expect(result.replies[0]?.text).toContain("Everyone send what you want");
  });

  it("records one preference per member and overwrites on a second message", () => {
    let snapshot = step(initialSnapshot(true), "m1", "Berkeley");
    snapshot = step(snapshot, "m1", "Mexican");
    snapshot = step(snapshot, "m1", "actually Korean");
    expect(Object.keys(snapshot.preferences)).toEqual(["m1"]);
    expect(snapshot.preferences["m1"]?.preferredCuisines).toContain("korean");
    expect(snapshot.preferences["m1"]?.preferredCuisines).not.toContain("mexican");
  });

  it("tracks each participant by their own handle", () => {
    let snapshot = step(initialSnapshot(true), "m1", "Berkeley");
    snapshot = step(snapshot, "m1", "Mexican");
    snapshot = step(snapshot, "m2", "Vegetarian");
    snapshot = step(snapshot, "m3", "Anything");
    expect(snapshot.activeMemberIds).toEqual(["m1", "m2", "m3"]);
    expect(Object.keys(snapshot.preferences).sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("refuses to recommend before anyone has answered", () => {
    let snapshot = step(initialSnapshot(true), "m1", "Berkeley");
    const result = transition(snapshot, event("m1", "done"));
    expect(result.snapshot.state).toBe("COLLECTING_PREFERENCES");
    expect(result.effects).toHaveLength(0);
    expect(result.replies[0]?.text).toContain("at least one answer");
  });

  it("emits a recommendation effect on DONE with answers", () => {
    let snapshot = step(initialSnapshot(true), "m1", "Berkeley");
    snapshot = step(snapshot, "m1", "Mexican");
    const result = transition(snapshot, event("m1", "done"));
    expect(result.snapshot.state).toBe("READY_TO_RECOMMEND");
    expect(result.effects).toContainEqual({ kind: "RUN_RECOMMENDATION" });
  });

  it("cancels from any active state", () => {
    let snapshot = step(initialSnapshot(true), "m1", "Berkeley");
    const result = transition(snapshot, event("m2", "cancel"));
    expect(result.snapshot.state).toBe("CANCELLED");
    expect(result.replies[0]?.text).toContain("Cancelled");
  });

  it("restarts a completed or cancelled session on PICK A PLACE", () => {
    const cancelled: SessionSnapshot = { ...initialSnapshot(true), state: "CANCELLED" };
    const result = transition(cancelled, event("m1", "pick a place"));
    expect(result.snapshot.state).toBe("COLLECTING_LOCATION");
    expect(result.snapshot.activeMemberIds).toEqual(["m1"]);
  });

  it("answers HELP in any state without changing it", () => {
    const snapshot = step(initialSnapshot(true), "m1", "Berkeley");
    const result = transition(snapshot, event("m2", "help"));
    expect(result.snapshot.state).toBe(snapshot.state);
    expect(result.replies[0]?.text).toContain("Here's how I work");
  });

  it("acknowledges STOP and START without corrupting the session", () => {
    const snapshot = step(initialSnapshot(true), "m1", "Berkeley");
    const stopped = transition(snapshot, event("m1", "STOP"));
    expect(stopped.snapshot.state).toBe("COLLECTING_PREFERENCES");
    expect(stopped.replies[0]?.text).toContain("opted out");

    const started = transition(stopped.snapshot, event("m1", "START"));
    expect(started.replies[0]?.text).toContain("back in");
  });

  it("does not treat a repeated command as new state when idempotent-safe", () => {
    // Sending 'done' twice with answers: the first advances, the second (now in
    // READY_TO_RECOMMEND) just re-emits the recommendation effect rather than
    // corrupting state. Callers dedupe by event id, but the reducer must be
    // safe if a duplicate slips through.
    let snapshot = step(initialSnapshot(true), "m1", "Berkeley");
    snapshot = step(snapshot, "m1", "Mexican");
    const once = transition(snapshot, event("m1", "done"));
    const twice = transition(once.snapshot, event("m1", "done"));
    expect(twice.snapshot.state).toBe("READY_TO_RECOMMEND");
    expect(twice.effects).toContainEqual({ kind: "RUN_RECOMMENDATION" });
  });
});
