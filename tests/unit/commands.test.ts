import { describe, expect, it } from "vitest";
import { parseCommand } from "@/domain/commands";

describe("parseCommand", () => {
  it("is case-insensitive and tolerates punctuation", () => {
    expect(parseCommand("EAT").kind).toBe("EAT");
    expect(parseCommand("  eat!  ").kind).toBe("EAT");
    expect(parseCommand("Pick a place.").kind).toBe("PICK_A_PLACE");
    expect(parseCommand("PICK A PLACE!!!").kind).toBe("PICK_A_PLACE");
    expect(parseCommand("Status?").kind).toBe("STATUS");
  });

  it("accepts natural phrasings of DONE", () => {
    expect(parseCommand("done").kind).toBe("DONE");
    expect(parseCommand("I'm done").kind).toBe("DONE");
    expect(parseCommand("that's everyone").kind).toBe("DONE");
  });

  it("parses votes with and without decoration", () => {
    expect(parseCommand("1")).toEqual({ kind: "VOTE", option: 1 });
    expect(parseCommand("#2")).toEqual({ kind: "VOTE", option: 2 });
    expect(parseCommand("option 3")).toEqual({ kind: "VOTE", option: 3 });
    expect(parseCommand("I vote 2")).toEqual({ kind: "VOTE", option: 2 });
  });

  it("parses vetoes with or without a space", () => {
    expect(parseCommand("veto 1")).toEqual({ kind: "VETO", option: 1 });
    expect(parseCommand("veto2")).toEqual({ kind: "VETO", option: 2 });
    expect(parseCommand("VETO #3")).toEqual({ kind: "VETO", option: 3 });
  });

  it("treats compliance keywords as opt-out and opt-in", () => {
    expect(parseCommand("STOP").kind).toBe("STOP");
    expect(parseCommand("unsubscribe").kind).toBe("STOP");
    expect(parseCommand("start").kind).toBe("START");
  });

  it("keeps CANCEL as a session command, not an opt-out", () => {
    expect(parseCommand("cancel").kind).toBe("CANCEL");
    expect(parseCommand("never mind").kind).toBe("CANCEL");
  });

  it("leaves preference text alone", () => {
    const command = parseCommand("Mexican or Korean, under $25");
    expect(command.kind).toBe("FREEFORM");
    expect(command).toMatchObject({ text: "Mexican or Korean, under $25" });
  });

  it("does not mistake a location for a command", () => {
    expect(parseCommand("94110").kind).toBe("FREEFORM");
    expect(parseCommand("Downtown Berkeley").kind).toBe("FREEFORM");
  });

  it("preserves the original text on freeform input", () => {
    expect(parseCommand("  ")).toEqual({ kind: "FREEFORM", text: "  " });
  });
});
