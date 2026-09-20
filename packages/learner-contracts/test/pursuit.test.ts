import { describe, expect, it } from "bun:test";
import {
  MAX_PURSUITS,
  addPursuit,
  buildPursuit,
  currentPursuit,
  dormantPursuits,
  normalizePursuits,
  pursuitKey,
  pursuitPromptLines,
  pursuitStanceForSession,
  retirePursuit,
  setAsidePursuit,
  setCurrentPursuit,
  startPursuit,
  touchPursuitSession,
  type Pursuit,
} from "../src/pursuit.js";

const at = (now: number) => ({ now });

function seed(...titles: string[]): Pursuit[] {
  return titles.reduce<Pursuit[]>((list, title, index) => addPursuit(list, { title, now: 1_000 + index }), []);
}

describe("a pursuit list, not a single goal", () => {
  it("holds many pursuits for one learner", () => {
    const pursuits = seed("Understand recursion", "Learn Portuguese", "Rebuild the deck");
    expect(pursuits).toHaveLength(3);
  });

  it("starts every new pursuit dormant so adding one never displaces the live one", () => {
    const seeded = seed("Recursion");
    const pursuits = setCurrentPursuit(seeded, seeded[0]!.id, at(2_000));
    const withSecond = addPursuit(pursuits, { title: "Portuguese", now: 3_000 });
    expect(currentPursuit(withSecond)?.title).toBe("Recursion");
    expect(withSecond.find((pursuit) => pursuit.title === "Portuguese")?.status).toBe("dormant");
  });

  it("refuses a pursuit with no title rather than storing a blank one", () => {
    expect(buildPursuit({ title: "   " })).toBeNull();
    expect(addPursuit([], { title: "" })).toEqual([]);
  });

  it("treats a re-stated pursuit as the same one", () => {
    const once = addPursuit([], { title: "Learn Rust", now: 1_000 });
    const twice = addPursuit(once, { title: "learn  rust", motivation: "for work", now: 2_000 });
    expect(twice).toHaveLength(1);
    expect(twice[0]!.motivation).toBe("for work");
    expect(pursuitKey("Learn Rust")).toBe(pursuitKey("learn  rust"));
  });

  it("bounds the list so history cannot grow without limit", () => {
    const many = Array.from({ length: MAX_PURSUITS + 10 }, (_, index) => ({
      id: `p${index}`, title: `Pursuit ${index}`, status: "dormant", createdAt: index, updatedAt: index,
    }));
    expect(normalizePursuits(many)).toHaveLength(MAX_PURSUITS);
  });

  it("keeps the most recently updated pursuits regardless of input order", () => {
    const many = Array.from({ length: MAX_PURSUITS + 2 }, (_, index) => ({
      id: `p${index}`, title: `Pursuit ${index}`, status: "dormant", createdAt: index, updatedAt: index,
    })).reverse();
    const normalized = normalizePursuits(many);
    expect(normalized.some((pursuit) => pursuit.id === "p0")).toBe(false);
    expect(normalized.some((pursuit) => pursuit.id === `p${MAX_PURSUITS + 1}`)).toBe(true);
  });

  it("makes a learner-declared starting point current in one operation", () => {
    const pursuits = startPursuit(seed("Existing"), { title: "New direction", now: 5_000 });
    expect(currentPursuit(pursuits)?.title).toBe("New direction");
    expect(pursuits.find((pursuit) => pursuit.title === "Existing")?.status).toBe("dormant");
  });

  it("rejects observed pursuits without exact provenance", () => {
    expect(buildPursuit({ title: "Compilers", source: "observed", evidence: "compilers" })).toBeNull();
    expect(buildPursuit({
      title: "Compilers",
      source: "observed",
      evidence: "compilers",
      evidenceQuoteSha256: "a".repeat(64),
      evidenceProvenance: { sessionId: "s", messageId: "m", start: 1, end: 10 },
    })).toMatchObject({ source: "observed", evidence: "compilers" });
  });
});

describe("at most one current pursuit", () => {
  it("makes exactly one current and sets the rest aside", () => {
    const pursuits = seed("A", "B", "C");
    const switched = setCurrentPursuit(pursuits, pursuits[1]!.id, at(5_000));
    expect(switched).toHaveLength(3);
    expect(switched.filter((pursuit) => pursuit.status === "current")).toHaveLength(1);
    expect(currentPursuit(switched)?.title).toBe("B");
  });

  it("sets the outgoing pursuit aside rather than abandoning it", () => {
    const seeded = seed("A", "B");
    const pursuits = setCurrentPursuit(seeded, seeded[0]!.id, at(5_000));
    expect(currentPursuit(pursuits)?.title).toBe("A");
    const switched = setCurrentPursuit(pursuits, pursuits[1]!.id, at(6_000));
    expect(currentPursuit(switched)?.title).toBe("B");
    expect(switched.find((pursuit) => pursuit.title === "A")?.status).toBe("dormant");
  });

  // Corrupt or merged storage must resolve, not throw and not lose the list.
  it("resolves two current pursuits in storage to the most recent", () => {
    const repaired = normalizePursuits([
      { id: "a", title: "A", status: "current", createdAt: 1, updatedAt: 10 },
      { id: "b", title: "B", status: "current", createdAt: 2, updatedAt: 20 },
    ]);
    expect(repaired.filter((pursuit) => pursuit.status === "current").map((pursuit) => pursuit.id)).toEqual(["b"]);
    expect(repaired.find((pursuit) => pursuit.id === "a")?.status).toBe("dormant");
    expect(repaired).toHaveLength(2);
  });

  it("does not let a newer dormant duplicate erase the current copy", () => {
    const repaired = normalizePursuits([
      { id: "current", title: "A", status: "current", createdAt: 1, updatedAt: 10 },
      { id: "duplicate", title: "a", status: "dormant", createdAt: 2, updatedAt: 20 },
    ]);
    expect(repaired).toHaveLength(1);
    expect(currentPursuit(repaired)?.id).toBe("current");
  });

  it("promotes nothing when the current pursuit is retired", () => {
    const seeded = seed("A", "B");
    const pursuits = setCurrentPursuit(seeded, seeded[0]!.id, at(5_000));
    expect(currentPursuit(pursuits)?.title).toBe("A");
    const retired = retirePursuit(pursuits, pursuits[0]!.id, "achieved", at(6_000));
    expect(currentPursuit(retired)).toBeNull();
    expect(retired.find((pursuit) => pursuit.title === "A")?.status).toBe("achieved");
  });

  it("sets a current pursuit aside without marking it achieved or abandoned", () => {
    const pursuits = startPursuit([], { id: "a", title: "A", now: 1 });
    const setAside = setAsidePursuit(pursuits, "a", { now: 2 });
    expect(currentPursuit(setAside)).toBeNull();
    expect(setAside[0]?.status).toBe("dormant");
  });

  it("ignores a switch to a pursuit that is not in the list", () => {
    const pursuits = seed("A");
    expect(setCurrentPursuit(pursuits, "missing", at(2_000))).toEqual(pursuits);
  });

  it("lists only dormant pursuits as resumable, newest first", () => {
    const pursuits = normalizePursuits([
      { id: "a", title: "A", status: "dormant", createdAt: 1, updatedAt: 10 },
      { id: "b", title: "B", status: "current", createdAt: 2, updatedAt: 20 },
      { id: "c", title: "C", status: "dormant", createdAt: 3, updatedAt: 30 },
      { id: "d", title: "D", status: "achieved", createdAt: 4, updatedAt: 40 },
    ]);
    expect(dormantPursuits(pursuits).map((pursuit) => pursuit.id)).toEqual(["c", "a"]);
  });
});

describe("a pursuit does not carry into a new session on its own", () => {
  const live = () => {
    const pursuits = seed("Recursion");
    return setCurrentPursuit(pursuits, pursuits[0]!.id, { now: 2_000, sessionId: "session-1" });
  };

  it("reads as confirmed only in the session that touched it", () => {
    expect(pursuitStanceForSession(live(), "session-1")).toMatchObject({ kind: "confirmed" });
  });

  it("reads as unconfirmed in a brand new session", () => {
    expect(pursuitStanceForSession(live(), "session-2")).toMatchObject({ kind: "unconfirmed" });
  });

  it("reads as unconfirmed when there is no session at all", () => {
    expect(pursuitStanceForSession(live(), null).kind).toBe("unconfirmed");
    expect(pursuitStanceForSession(live(), "").kind).toBe("unconfirmed");
  });

  it("reads as none when nothing is current", () => {
    expect(pursuitStanceForSession(seed("A", "B"), "session-1")).toEqual({ kind: "none" });
    expect(pursuitStanceForSession([], "session-1")).toEqual({ kind: "none" });
  });

  it("becomes confirmed once the session works on it", () => {
    const pursuits = live();
    const touched = touchPursuitSession(pursuits, pursuits[0]!.id, "session-2", at(3_000));
    expect(pursuitStanceForSession(touched, "session-2").kind).toBe("confirmed");
    expect(pursuitStanceForSession(touched, "session-1").kind).toBe("unconfirmed");
  });
});

describe("what the tutor is told", () => {
  it("tells the tutor to follow the learner when nothing is recorded", () => {
    const lines = pursuitPromptLines([], { kind: "none" });
    expect(lines.join(" ")).toContain("do not ask them to name a goal before helping");
  });

  it("warns that an unconfirmed pursuit may not be today's subject", () => {
    const pursuits = seed("Recursion");
    const live = setCurrentPursuit(pursuits, pursuits[0]!.id, { now: 2_000, sessionId: "session-1" });
    const lines = pursuitPromptLines(live, pursuitStanceForSession(live, "session-2"));
    expect(lines.join(" ")).toContain("not necessarily what they want now");
    expect(lines.join(" ")).toContain("follow them there");
  });

  it("does not warn when the session is already on the pursuit", () => {
    const pursuits = seed("Recursion");
    const live = setCurrentPursuit(pursuits, pursuits[0]!.id, { now: 2_000, sessionId: "session-1" });
    const lines = pursuitPromptLines(live, pursuitStanceForSession(live, "session-1"));
    expect(lines.join(" ")).toContain("already working on that pursuit");
    expect(lines.join(" ")).not.toContain("not necessarily what they want now");
  });

  it("mentions set-aside pursuits without inviting the tutor to raise them", () => {
    const pursuits = seed("A", "B", "C");
    const lines = pursuitPromptLines(pursuits, { kind: "none" });
    expect(lines.join(" ")).toContain("only if the learner returns to it");
  });
});

describe("malformed storage", () => {
  it("returns an empty list rather than throwing", () => {
    for (const value of [null, undefined, "not a list", 42, {}]) {
      expect(normalizePursuits(value)).toEqual([]);
    }
  });

  it("drops entries that are not usable pursuits", () => {
    expect(normalizePursuits([null, 7, [], { title: "" }, { notATitle: true }, { title: "Real" }]))
      .toHaveLength(1);
  });

  it("falls back to a safe status and source for unknown values", () => {
    const [pursuit] = normalizePursuits([{ title: "A", status: "wat", source: "telepathy" }]);
    expect(pursuit!.status).toBe("dormant");
    expect(pursuit!.source).toBe("declared");
  });
});
