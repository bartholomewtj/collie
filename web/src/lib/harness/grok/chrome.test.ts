import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseAnsi } from "../../ansi";
import { lineText, splitLines, type StyledLine } from "../../blocks";
import {
  extractInputDraft,
  extractStatusLines,
  hasComposer,
  locateComposer,
  stripChrome,
  tightenText,
} from "./chrome";

const PANES_DIR = join(import.meta.dirname, "..", "..", "..", "fixtures", "panes");

function fixtureLines(name: string): StyledLine[] {
  return splitLines(parseAnsi(readFileSync(join(PANES_DIR, name), "utf8")));
}

function joined(lines: StyledLine[]): string {
  return lines.map(lineText).join("\n");
}

const GROK_FIXTURES = readdirSync(PANES_DIR)
  .filter((f) => f.startsWith("grok--") && f.endsWith(".txt"))
  .sort();

describe("stripChrome — peels the Grok composer off the tail", () => {
  it.each(GROK_FIXTURES)("%s: drops the box, hint, and ─ borders", (name) => {
    const original = fixtureLines(name);
    const kept = stripChrome(original);
    const text = joined(kept);
    expect(kept.length).toBeLessThan(original.length);
    expect(text).not.toMatch(/╭─+╮/);
    expect(text).not.toContain("Enter:send now");
    expect(text).not.toContain("always-approve");
    expect(text).toContain("Yes. Tap the image button on the reply box.");
  });

  it("fresh-idle: keeps the transcript, drops the empty box", () => {
    const text = joined(stripChrome(fixtureLines("grok--fresh-idle.txt")));
    expect(text).toContain("can I attach images from the phone?");
    expect(text).not.toContain("│ >");
  });

  it("working: peels the activity row with the box", () => {
    const text = joined(stripChrome(fixtureLines("grok--working.txt")));
    expect(text).not.toContain("[stop]");
    expect(text).toContain("Yes. Tap the image button");
  });

  it("draft-single: the stranded draft is not left on the mirror", () => {
    const text = joined(stripChrome(fixtureLines("grok--draft-single.txt")));
    expect(text).not.toContain("look at this screenshot");
  });

  it("returns the same reference when there is no composer", () => {
    const lines = splitLines(parseAnsi("hello\nworld"));
    expect(stripChrome(lines)).toBe(lines);
  });

  it("only trims trailing blanks when no box is present", () => {
    const lines = splitLines(parseAnsi("output line\n\n\n"));
    expect(joined(stripChrome(lines))).toBe("output line");
  });
});

describe("tightenText — collapses Grok's right-aligned pad", () => {
  it("pulls a trailing timestamp in next to the body", () => {
    const padded = "     Yes. Tap the image button." + " ".repeat(40) + "3:01 PM";
    expect(tightenText(padded)).toBe("     Yes. Tap the image button.  3:01 PM");
  });

  it("leaves a short gap alone", () => {
    expect(tightenText("hello   world")).toBe("hello   world");
  });
});

describe("extractStatusLines / extractInputDraft / hasComposer", () => {
  it("working: surfaces the activity row and the model label", () => {
    const rows = extractStatusLines(fixtureLines("grok--working.txt")).map((l) =>
      lineText(l),
    );
    expect(rows.some((r) => r.includes("[stop]"))).toBe(true);
    expect(rows.some((r) => r.includes("Grok 4.6"))).toBe(true);
  });

  it("fresh-idle: only the model label (no activity row)", () => {
    const rows = extractStatusLines(fixtureLines("grok--fresh-idle.txt")).map((l) =>
      lineText(l),
    );
    expect(rows.some((r) => r.includes("[stop]"))).toBe(false);
    expect(rows.some((r) => r.includes("Grok 4.6"))).toBe(true);
  });

  it("draft-single: recovers the stranded draft", () => {
    expect(extractInputDraft(fixtureLines("grok--draft-single.txt"))).toBe(
      "look at this screenshot",
    );
  });

  it("draft-wrapped: folds continuation rows into one draft", () => {
    expect(extractInputDraft(fixtureLines("grok--draft-wrapped.txt"))).toBe(
      "this is a long draft that will not fit on one row of the box",
    );
  });

  it("empty box: no draft chip", () => {
    expect(extractInputDraft(fixtureLines("grok--fresh-idle.txt"))).toBeNull();
  });

  it("hasComposer is true on every grok fixture", () => {
    for (const name of GROK_FIXTURES) {
      expect(hasComposer(fixtureLines(name))).toBe(true);
    }
  });

  it("hasComposer is false on a claude idle screen", () => {
    expect(hasComposer(fixtureLines("claude--fresh-idle.txt"))).toBe(false);
  });

  it("locateComposer pins top / prompt / bottom in order", () => {
    const box = locateComposer(fixtureLines("grok--fresh-idle.txt"));
    expect(box).not.toBeNull();
    expect(box!.top).toBeLessThan(box!.prompt);
    expect(box!.prompt).toBeLessThan(box!.bottom);
  });
});
