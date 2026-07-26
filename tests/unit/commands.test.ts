import { describe, expect, it } from "vitest";
import { idleDisposition, isWakePhrase, parseCommand } from "@/domain/commands";

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

  it("recognizes intentional Viand wake phrases", () => {
    for (const phrase of [
      "Hey Viand",
      "Hi, Viand!",
      "hello @viand",
      "@Viand",
      "Viand, pick a place",
      "Hey Viand, where should we eat?",
    ]) {
      expect(isWakePhrase(phrase)).toBe(true);
      expect(parseCommand(phrase).kind).toBe("PICK_A_PLACE");
    }
  });

  it("does not wake on incidental mentions or the old start command", () => {
    expect(isWakePhrase("Viand is a cool name")).toBe(false);
    expect(isWakePhrase("pick a place")).toBe(false);
    expect(isWakePhrase("we talked about Viand yesterday")).toBe(false);
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

  it("parses a request for details about an option", () => {
    for (const phrase of [
      "details 2",
      "detail 2",
      "more about 2",
      "tell me more about 2",
      "info 2",
      "DETAILS #2",
    ]) {
      expect(parseCommand(phrase)).toEqual({ kind: "DETAILS", option: 2 });
    }
  });

  it("accepts a details request with no option named", () => {
    expect(parseCommand("details")).toEqual({ kind: "DETAILS", option: null });
    expect(parseCommand("more info")).toEqual({ kind: "DETAILS", option: null });
  });

  it("keeps a bare INFO as help rather than details", () => {
    expect(parseCommand("info").kind).toBe("HELP");
  });

  it("accepts votes and vetoes up to five", () => {
    expect(parseCommand("5")).toEqual({ kind: "VOTE", option: 5 });
    expect(parseCommand("veto 4")).toEqual({ kind: "VETO", option: 4 });
    // Six options are never presented, so this is preference text.
    expect(parseCommand("6").kind).toBe("FREEFORM");
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

describe("idleDisposition", () => {
  it("activates on an intentional invocation", () => {
    for (const phrase of ["@Viand", "Hey Viand", "pick a place", "Viand, pick a place"]) {
      expect(idleDisposition(parseCommand(phrase))).toBe("activate");
    }
  });

  it("answers HELP and CANCEL with no session running", () => {
    expect(idleDisposition(parseCommand("help"))).toBe("answer");
    expect(idleDisposition(parseCommand("cancel"))).toBe("answer");
  });

  it("ignores ordinary group chatter", () => {
    for (const phrase of ["Downtown Berkeley", "1", "veto 2", "done", "lol same", "status"]) {
      expect(idleDisposition(parseCommand(phrase))).toBe("ignore");
    }
  });
});
