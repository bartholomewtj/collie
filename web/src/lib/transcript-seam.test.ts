import { describe, expect, it } from "vitest";

import {
  commandsOnlyTurn,
  findSeam,
  liveMirrorNeeded,
  newestTurnInViewport,
  trimAtSeam,
} from "./transcript-seam";
import type { TranscriptEntry } from "./types";

function turn(uuid: string, role: TranscriptEntry["role"], text: string): TranscriptEntry {
  return { uuid, ts: "2026-08-20T00:00:00Z", role, parts: [{ kind: "text", text }] };
}

// Long enough to clear SEAM_PROBE_TOKENS (12) on either side of the cut.
const HEAD =
  "Three things stand out after the sweep across every repo I could reach this morning and afternoon.";
const TAIL =
  "Nothing else is broken — services are up, the tests all pass, and the context map is current now.";
const MESSAGE = `${HEAD} ${TAIL}`;

describe("findSeam", () => {
  it("returns null when the mirror shares nothing with the transcript", () => {
    const entries = [turn("a", "assistant", MESSAGE)];
    expect(findSeam(entries, "$ ls -la\ntotal 48\ndrwxr-xr-x 12 barth staff 384 Aug 20 15:13 .")).toBeNull();
  });

  it("returns null when the mirror is too short to probe", () => {
    expect(findSeam([turn("a", "assistant", MESSAGE)], "working…")).toBeNull();
  });

  it("finds the cut point mid-message when the mirror opens part-way in", () => {
    const entries = [turn("a", "assistant", MESSAGE)];
    const seam = findSeam(entries, `broken tail fragment\n${TAIL}`);
    expect(seam).toEqual({ entry: 0, part: 0, char: MESSAGE.indexOf(TAIL) });
  });

  it("matches through terminal wrapping and eaten markdown syntax", () => {
    // The transcript holds markdown; the terminal wraps hard and prints neither the backticks nor
    // the bold asterisks. Same passage, and it must still be recognised as one.
    const entries = [
      turn("a", "assistant", `${HEAD} My suggestion: **branch + PR** for \`collie\`, direct commit on the other three.`),
    ];
    const mirror = "filler words here to push the probe past the first token boundary\nMy\nsuggestion: branch + PR for\ncollie, direct commit on the\nother three.";
    expect(findSeam(entries, mirror)).not.toBeNull();
  });

  it("takes the last occurrence when a passage repeats", () => {
    const entries = [turn("a", "assistant", MESSAGE), turn("b", "assistant", MESSAGE)];
    expect(findSeam(entries, `x ${MESSAGE}`)?.entry).toBe(1);
  });
});

describe("trimAtSeam", () => {
  it("returns the same array reference when nothing overlaps", () => {
    const entries = [turn("a", "assistant", MESSAGE)];
    expect(trimAtSeam(entries, "$ git status --short\n M AGENTS.md\n?? GEMINI.md\nnothing to commit here")).toBe(entries);
  });

  it("cuts a straddling message at the seam and keeps its head", () => {
    const entries = [turn("a", "assistant", MESSAGE)];
    const out = trimAtSeam(entries, `fragment\n${TAIL}`);
    expect(out).toHaveLength(1);
    expect(out[0]!.parts).toEqual([{ kind: "text", text: HEAD }]);
  });

  it("drops turns the mirror covers whole, and everything after them", () => {
    const entries = [
      turn("a", "assistant", "An older answer nobody is looking at any more, well off the viewport."),
      turn("b", "assistant", MESSAGE),
      turn("c", "user", "do 1 and 2 for me and update the docs to current"),
    ];
    const out = trimAtSeam(entries, `x ${MESSAGE}\n> do 1 and 2 for me and update the docs to current`);
    expect(out.map((e) => e.uuid)).toEqual(["a"]);
  });

  it("leaves earlier parts of the cut turn intact", () => {
    const entries: TranscriptEntry[] = [
      {
        uuid: "a",
        ts: "2026-08-20T00:00:00Z",
        role: "assistant",
        parts: [
          { kind: "tool", name: "Bash", summary: "git status --short" },
          { kind: "text", text: MESSAGE },
        ],
      },
    ];
    const out = trimAtSeam(entries, `fragment\n${MESSAGE}`);
    expect(out[0]!.parts).toEqual([{ kind: "tool", name: "Bash", summary: "git status --short" }]);
  });
});

describe("newestTurnInViewport", () => {
  it("is false when the journal is empty or the mirror shares nothing with it", () => {
    expect(newestTurnInViewport([], `x ${MESSAGE}`)).toBe(false);
    expect(newestTurnInViewport([turn("a", "assistant", MESSAGE)], "unrelated pane output that is long enough to probe past twelve tokens easily")).toBe(false);
  });

  it("is true only when the seam sits on the newest turn, not an older one still in the window", () => {
    const later =
      "Completely different prose about the weather on the coast this week after the rain finally stopped falling overnight.";
    const entries = [turn("a", "assistant", MESSAGE), turn("b", "assistant", later)];
    expect(newestTurnInViewport([entries[0]!], `x ${MESSAGE}`)).toBe(true);
    expect(newestTurnInViewport(entries, `x ${MESSAGE}`)).toBe(false);
  });

  it("is false when the newest turn has no text (a tool call the screen never printed)", () => {
    const entries: TranscriptEntry[] = [
      turn("a", "assistant", MESSAGE),
      {
        uuid: "b",
        ts: "2026-08-20T00:00:00Z",
        role: "assistant",
        parts: [{ kind: "tool", name: "Bash", summary: "git status --short" }],
      },
    ];
    expect(newestTurnInViewport(entries, `x ${MESSAGE}`)).toBe(false);
  });
});

describe("commandsOnlyTurn", () => {
  it("returns false for an empty transcript", () => {
    expect(commandsOnlyTurn([])).toBe(false);
  });

  it("returns true when the newest entry holds a tool part with no result", () => {
    const entries: TranscriptEntry[] = [
      turn("a", "user", "run tests"),
      {
        uuid: "b",
        ts: "2026-08-20T00:00:00Z",
        role: "assistant",
        parts: [{ kind: "tool", name: "Bash", summary: "npm test" }],
      },
    ];
    expect(commandsOnlyTurn(entries)).toBe(true);
  });

  it("returns false when the newest entry's tool part has a result attached", () => {
    const entries: TranscriptEntry[] = [
      {
        uuid: "b",
        ts: "2026-08-20T00:00:00Z",
        role: "assistant",
        parts: [{ kind: "tool", name: "Bash", summary: "npm test", result: { text: "pass" } }],
      },
    ];
    expect(commandsOnlyTurn(entries)).toBe(false);
  });

  it("returns false when the newest entry is text-only", () => {
    const entries: TranscriptEntry[] = [
      {
        uuid: "a",
        ts: "2026-08-20T00:00:00Z",
        role: "assistant",
        parts: [{ kind: "tool", name: "Bash", summary: "npm test" }],
      },
      turn("b", "assistant", "All tests passed!"),
    ];
    expect(commandsOnlyTurn(entries)).toBe(false);
  });
});

describe("liveMirrorNeeded", () => {
  const idleCaughtUp = {
    status: "idle" as const,
    dialogPresent: false,
    rawTerminal: false,
    findOpen: false,
    hasTranscript: true,
    newestTurnInViewport: true,
    pinned: false,
  };

  it("hides the tail for an idle pane whose transcript already holds the newest turn", () => {
    expect(liveMirrorNeeded(idleCaughtUp)).toBe(false);
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "done" })).toBe(false);
  });

  it("hides the tail when commandsOnly is true even if working", () => {
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "working", commandsOnly: true })).toBe(false);
  });

  it("pinned, dialogPresent, rawTerminal, and findOpen still show live even with commandsOnly", () => {
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "working", commandsOnly: true, pinned: true })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "working", commandsOnly: true, dialogPresent: true })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "working", commandsOnly: true, rawTerminal: true })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "working", commandsOnly: true, findOpen: true })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "working", commandsOnly: true, hasTranscript: false })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "working", commandsOnly: true, kind: "shell" })).toBe(true);
  });

  it("keeps the tail while the journal has not caught the viewport", () => {
    expect(liveMirrorNeeded({ ...idleCaughtUp, newestTurnInViewport: false })).toBe(true);
  });

  it("keeps the tail whenever the TUI is the thing you need", () => {
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "working" })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "blocked" })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, status: "unknown" })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, dialogPresent: true })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, rawTerminal: true })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, findOpen: true })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, kind: "shell" })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, hasTranscript: false })).toBe(true);
    expect(liveMirrorNeeded({ ...idleCaughtUp, pinned: true })).toBe(true);
  });
});
