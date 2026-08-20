import { describe, expect, it } from "vitest";

import { findSeam, trimAtSeam } from "./transcript-seam";
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
