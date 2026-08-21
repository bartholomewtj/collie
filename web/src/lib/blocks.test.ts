import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseAnsi, type AnsiSegment } from "./ansi";
import { lineText, presentBlocks, presentLine, presentLines, splitLines, type StyledLine } from "./blocks";
import { buildBlocks } from "./harness";
import { isBoxBorder, isHorizontalRule } from "./harness/claude/markers";

// Anchored on this file's directory (not `new URL(import.meta.url)`, which Vite rewrites to an asset).
const PANES_DIR = join(import.meta.dirname, "..", "fixtures", "panes");
const fixtureLines = (name: string): StyledLine[] =>
  splitLines(parseAnsi(readFileSync(join(PANES_DIR, name), "utf8")));
const blockText = (lines: StyledLine[]) =>
  lines.map((l) => l.segments.map((s) => s.text).join("")).join("\n");

// splitLines is the seam between the ANSI parse and the renderer. Its load-bearing invariant (find
// depends on it): joining every line's text with "\n" reproduces the original visible string
// character-for-character. These tests pin that byte-fidelity across empty lines, trailing newlines,
// and segments that carry newlines mid-run — plus that styling survives a split.

const ESC = "\x1b";

/** Minimal styled segment for constructing inputs directly (bypassing the parser). */
const seg = (text: string, extra: Partial<AnsiSegment> = {}): AnsiSegment => ({
  text,
  style: {},
  muted: false,
  ...extra,
});

/** Reconstruct the visible string the way find's coordinate space does: lines joined by "\n". */
const joinLines = (lines: { segments: AnsiSegment[] }[]) =>
  lines.map((l) => l.segments.map((s) => s.text).join("")).join("\n");

describe("splitLines — exact text preservation", () => {
  it("keeps a single newline-free line intact and reuses the segment object (no clone)", () => {
    const s = seg("hello world");
    const lines = splitLines([s]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.segments[0]).toBe(s); // same reference — the no-allocation fast path
    expect(joinLines(lines)).toBe("hello world");
  });

  it("yields a single empty line for no segments", () => {
    const lines = splitLines([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.segments).toEqual([]);
    expect(joinLines(lines)).toBe("");
  });

  it("represents a trailing newline as a terminating empty line", () => {
    // Parser emits one segment per newline-terminated run: "a\n", "b\n".
    const lines = splitLines([seg("a\n"), seg("b\n")]);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["a", "b", ""]);
    expect(lines[2]!.segments).toEqual([]); // the trailing blank carries no segment
    expect(joinLines(lines)).toBe("a\nb\n");
  });

  it("preserves interior empty lines (adjacent newlines)", () => {
    const lines = splitLines(parseAnsi("a\n\nb"));
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["a", "", "b"]);
    expect(lines[1]!.segments).toEqual([]);
    expect(joinLines(lines)).toBe("a\n\nb");
  });

  it("splits a single segment that spans multiple newlines into one line each", () => {
    const lines = splitLines([seg("foo\nbar\nbaz")]);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["foo", "bar", "baz"]);
    expect(joinLines(lines)).toBe("foo\nbar\nbaz");
  });

  it("drops empty pieces from a leading newline but still opens a blank first line", () => {
    const lines = splitLines([seg("\nx")]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.segments).toEqual([]);
    expect(lines[1]!.segments.map((s) => s.text)).toEqual(["x"]);
    expect(joinLines(lines)).toBe("\nx");
  });

  it("keeps a styled segment's style/flags on both sides when split across a newline", () => {
    const styled = seg("red1\nred2", {
      fg: "var(--ansi-1)",
      bold: true,
      muted: false,
      style: { color: "var(--ansi-1)", fontWeight: 600 },
    });
    const lines = splitLines([styled]);
    expect(lines).toHaveLength(2);
    const [a, b] = [lines[0]!.segments[0]!, lines[1]!.segments[0]!];
    expect([a.text, b.text]).toEqual(["red1", "red2"]);
    // Both halves carry the original style metadata (cloned, not the same reference).
    for (const half of [a, b]) {
      expect(half.fg).toBe("var(--ansi-1)");
      expect(half.bold).toBe(true);
      expect(half.style).toEqual({ color: "var(--ansi-1)", fontWeight: 600 });
    }
    expect(joinLines(lines)).toBe("red1\nred2");
  });
});

describe("presentLines — no-wrap terminal borders and boxes", () => {
  // This is the complete horizontal subset of the established Claude rule contract. Keep it
  // independent from the clipping classifier so adding a Claude-accepted horizontal glyph cannot
  // silently leave it wrapping. Corners, junctions, and vertical box drawing are deliberately absent.
  const pureHorizontalRuleGlyphs = [
    ..."─━┄┅┈┉╌╍═╴╶╸╺╼╾",
    ...Array.from({ length: 0x2594 - 0x2581 + 1 }, (_, i) => String.fromCodePoint(0x2581 + i)),
    ..."‒–—―",
  ];

  it("clips every established pure horizontal rule glyph only at the long-border threshold", () => {
    for (const glyph of pureHorizontalRuleGlyphs) {
      // Claude recognizes rules at three glyphs; visual clipping remains intentionally stricter.
      expect(isHorizontalRule(glyph.repeat(3)), glyph).toBe(true);
      expect(presentLines(splitLines(parseAnsi(glyph.repeat(19))))[0]!.noWrap, glyph).toBeUndefined();
      expect(presentLines(splitLines(parseAnsi(glyph.repeat(20))))[0]!.noWrap, glyph).toBe(true);
    }
  });

  it("marks an ANSI-segmented border", () => {
    const border = "─".repeat(20);
    const ansi = presentLines(
      splitLines(parseAnsi(`${ESC}[31m${border.slice(0, 10)}${ESC}[34m${border.slice(10)}${ESC}[0m`)),
    )[0]!;

    expect(ansi.noWrap).toBe(true);
    expect(ansi.segments).toHaveLength(2);
    expect(joinLines([ansi])).toBe(border);
  });

  it("presents a single StyledLine directly via presentLine", () => {
    const rawLine = splitLines(parseAnsi("│ col 1      │ col 2      │"))[0]!;
    const presented = presentLine(rawLine);
    expect(presented.noWrap).toBe(true);
    expect(lineText(presented)).toBe("│ col 1      │ col 2      │");
  });

  it("clips at twenty glyphs and not below", () => {
    expect(presentLines(splitLines(parseAnsi("─".repeat(19))))[0]!.noWrap).toBeUndefined();
    expect(presentLines(splitLines(parseAnsi("─".repeat(20))))[0]!.noWrap).toBe(true);
  });

  // The clip rule and the input-box grammar both call a line a "border", for different consumers
  // (see rule-glyphs.ts). A labelled border is the case where they must visibly disagree: the guard
  // has to recognise it, and clipping it would crop the session label out of view. Pinned across
  // both modules so a future edit to either cannot quietly align them.
  it("never clips a labelled input-box border the guard depends on", () => {
    const labelled = `${"─".repeat(20)} japanese technical troubleshooting ${"─".repeat(2)}`;
    expect(isBoxBorder(labelled)).toBe(true);
    expect(presentLines(splitLines(parseAnsi(labelled)))[0]!.noWrap).toBeUndefined();
  });

  it.each([
    ["short Unicode rule", "─".repeat(19)],
    ["ASCII rule", "-".repeat(40)],
    ["labeled border", `${"─".repeat(20)} Pi ${"─".repeat(20)}`],
    ["mixed rule row", "─".repeat(19) + "╌"],
    ["mixed content", `${"─".repeat(20)}x`],
    ["short rounded box", `╭${"─".repeat(10)}╮`],
    ["prose", "This ordinary prose should retain its normal wrapping behavior."],
    ["prose with interior vertical bar", "Prose with an interior │ column separator should wrap."],
    ["two-pipe shell snippet", `| ${"col".repeat(10)} |`],
    [
      "boxed prose",
      `│ Yes. Tap the image button on the reply box. This is a long answer. │`,
    ],
    ["boxed grok draft", "│ > this is a long draft that will not fit on one row │"],
  ])("does not mark %s", (_name, text) => {
    expect(presentLines(splitLines(parseAnsi(text)))[0]!.noWrap).toBeUndefined();
  });

  // Superseded pins: square table edges, vertical runs, corner runs, and long rounded boxes now clip.
  it.each([
    ["table edge (square)", `┌${"─".repeat(40)}┐`],
    ["corner row", "┌".repeat(40)],
    ["vertical row", "│".repeat(40)],
    ["enclosed box/table row", `│ ${"col 1".padEnd(10)} │ ${"col 2".padEnd(10)} │`],
    ["padded composer chrome", `│ >${" ".repeat(40)}│`],
    ["junction row", `├──${"─".repeat(15)}──┤`],
    ["short rounded box ≥ 20 chars", `╭${"─".repeat(19)}╮`],
    ["GFM pipe table row", "| Flag | Default | Type | Applies to | Notes |"],
    ["GFM delimiter row", "|---|---|---|---|---|"],
  ])("marks %s as noWrap", (_name, text) => {
    expect(presentLines(splitLines(parseAnsi(text)))[0]!.noWrap).toBe(true);
  });

  it("leaves short enclosed box rows (< 20 chars) wrapping", () => {
    expect(presentLines(splitLines(parseAnsi("│ a │ b │")))[0]!.noWrap).toBeUndefined();
  });

  // Grok/omp composer chrome: a rounded full-width box. Wrap-on would otherwise turn each
  // 200-column `╭─╮` / `╰─╯` into a wall of `─` on a phone.
  it("clips a long rounded box border, including Grok's labelled bottom", () => {
    const top = `  ╭${"─".repeat(40)}╮  `;
    const bottom = `  ╰${"─".repeat(20)} Grok 4.6 (high) · always-approve ─╯`;
    expect(presentLines(splitLines(parseAnsi(top)))[0]!.noWrap).toBe(true);
    expect(presentLines(splitLines(parseAnsi(bottom)))[0]!.noWrap).toBe(true);
  });
});

describe("presentLines — full-width highlight rows and padding strip", () => {
  it("strips trailing pad from a full-width inverted highlight and still wraps (it is prose, not a table)", () => {
    const line = `${ESC}[7mHighlighted header${" ".repeat(30)}${ESC}[27m`;
    const presented = presentLines(splitLines(parseAnsi(line)))[0]!;
    expect(presented.noWrap).toBeUndefined();
    expect(lineText(presented)).toBe("Highlighted header");
    expect(presented.segments[0]!.bg).toBeDefined();
  });

  it("does not mark a highlight row without trailing padding", () => {
    const line = `${ESC}[7mHighlighted header${ESC}[27m`;
    const presented = presentLines(splitLines(parseAnsi(line)))[0]!;
    expect(presented.noWrap).toBeUndefined();
    expect(lineText(presented)).toBe("Highlighted header");
  });

  it("strips a highlight row with leading unpainted indent and trailing painted pad, and wraps it", () => {
    const line = `   ${ESC}[44mTitle${" ".repeat(20)}${ESC}[0m`;
    const presented = presentLines(splitLines(parseAnsi(line)))[0]!;
    expect(presented.noWrap).toBeUndefined();
    expect(lineText(presented)).toBe("   Title");
  });

  it("wraps a long highlighted prose line after stripping the terminal-width pad", () => {
    const prose = "Yes. Tap the image button on the reply box. This is a long painted message.";
    const line = `${ESC}[7m${prose}${" ".repeat(40)}${ESC}[27m`;
    const presented = presentLines(splitLines(parseAnsi(line)))[0]!;
    expect(presented.noWrap).toBeUndefined();
    expect(lineText(presented)).toBe(prose);
  });

  it("does not mark a highlighted word followed by unstyled trailing spaces", () => {
    const line = `${ESC}[44mWord${ESC}[0m${" ".repeat(20)}`;
    const presented = presentLines(splitLines(parseAnsi(line)))[0]!;
    expect(presented.noWrap).toBeUndefined();
    // The trailing spaces are still stripped by step 4:
    expect(lineText(presented)).toBe("Word");
  });

  it("strips trailing spaces ≥ 2 while preserving styles on surviving text", () => {
    const line = `${ESC}[31mred${ESC}[0m${ESC}[44mblue    ${ESC}[0m`;
    const presented = presentLines(splitLines(parseAnsi(line)))[0]!;
    expect(lineText(presented)).toBe("redblue");
    expect(presented.segments).toHaveLength(2);
    expect(presented.segments[0]!.fg).toBe("var(--ansi-1)");
    expect(presented.segments[1]!.bg).toBe("var(--ansi-4)");
    expect(presented.segments[1]!.text).toBe("blue");
  });

  it("drops segments completely emptied by the trailing space trim", () => {
    const line = `${ESC}[31mred${ESC}[0m${ESC}[44m    ${ESC}[0m`;
    const presented = presentLines(splitLines(parseAnsi(line)))[0]!;
    expect(lineText(presented)).toBe("red");
    expect(presented.segments).toHaveLength(1);
    expect(presented.segments[0]!.text).toBe("red");
  });

  it("preserves a single trailing space byte-faithfully", () => {
    const line = "typed input ";
    const presented = presentLines(splitLines(parseAnsi(line)))[0]!;
    expect(lineText(presented)).toBe("typed input ");
  });

  it("turns an all-space coloured line into empty segments (coloured empty line vanishes)", () => {
    const line = `${ESC}[41m            ${ESC}[0m`;
    const presented = presentLines(splitLines(parseAnsi(line)))[0]!;
    expect(presented.segments).toEqual([]);
    expect(lineText(presented)).toBe("");
  });

  it("preserves interior spaces column-faithfully", () => {
    const line = "col1      col2      col3";
    const presented = presentLines(splitLines(parseAnsi(line)))[0]!;
    expect(lineText(presented)).toBe("col1      col2      col3");
  });
});

describe("splitLines — round-trips the parser's visible text (find coordinate space)", () => {
  const cases = [
    "hello world",
    "line1\nline2\nline3",
    "a\n\nb", // interior blank
    "done\n", // trailing newline
    "\nleading", // leading newline
    `${ESC}[31mred\nstill red${ESC}[0m\nplain`, // styling across newlines
    "line one\r\nline two\r\n", // CRLF (parser normalises the \r away)
  ];
  for (const input of cases) {
    it(`join(splitLines) === visible text for ${JSON.stringify(input)}`, () => {
      const segments = parseAnsi(input);
      const visible = segments.map((s) => s.text).join("");
      expect(joinLines(splitLines(segments))).toBe(visible);
    });
  }
});

describe("buildBlocks", () => {
  it("wraps all lines in a single raw block spanning the full range", () => {
    const lines = splitLines(parseAnsi("a\nb\nc"));
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("raw");
    expect(blocks[0]!.lines).toBe(lines); // the same line array — covers every line
    expect(blocks[0]!.lines).toHaveLength(3);
  });

  it("still emits one raw block (with one empty line) for empty input", () => {
    const blocks = buildBlocks(splitLines(parseAnsi("")));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("raw");
    expect(blocks[0]!.lines).toEqual([{ segments: [] }]);
  });
});

describe("buildBlocks — Claude grammars (ctx.agent === 'claude')", () => {
  it("splits a tail menu into [raw before, prompt-select], keeping the question above the buttons", () => {
    const lines = fixtureLines("claude--select-menu.txt");
    const blocks = buildBlocks(lines, { agent: "claude" });
    expect(blocks.map((b) => b.kind)).toEqual(["raw", "prompt-select"]);

    const raw = blocks[0]!;
    const prompt = blocks[1]!;
    if (raw.kind !== "raw" || prompt.kind !== "prompt-select") throw new Error("unexpected block kinds");
    // The question stays in the raw block above (not duplicated inside the button group).
    expect(blockText(raw.lines)).toContain("Which color theme should the dashboard use?");
    // The typed payload carries the detected model + the raw region it replaced.
    expect(prompt.prompt.family).toBe("select");
    expect(prompt.prompt.options.map((o) => o.label)).toEqual(["Red", "Green", "Blue", "Chat about this"]);
    expect(blockText(prompt.lines)).toContain("Enter to select"); // the replaced footer lives here
  });

  it("keeps the plan fixture's long dashed separators as clipped raw rows", () => {
    const blocks = presentBlocks(
      buildBlocks(fixtureLines("claude--plan-approval.txt"), { agent: "claude" }),
    );
    const raw = blocks[0]!;
    if (raw.kind !== "raw") throw new Error("expected raw scrollback before the plan prompt");

    const dashedRules = raw.lines.filter((line) => lineText(line).trim().startsWith("╌"));
    expect(dashedRules).toHaveLength(2);
    expect(dashedRules.every((line) => line.noWrap)).toBe(true);
  });

  it("strips trailing input-box chrome when there is no menu (single raw block)", () => {
    const lines = fixtureLines("claude--fresh-idle.txt");
    const blocks = buildBlocks(lines, { agent: "claude" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("raw");
    const kept = blockText(blocks[0]!.lines);
    expect(kept).toContain("Welcome back Altan!");
    expect(kept).not.toContain("← for agents"); // the input-box statusline/hint is gone
    expect(blocks[0]!.lines.length).toBeLessThan(lines.length);
  });

  // "No adapter", not "non-Claude": omp is a non-Claude agent that DOES have one (it just up-levels
  // nothing). What gates these grammars is the registry lookup, not the string "claude".
  it("leaves an agent with no adapter as a single untouched raw block (conservative gating)", () => {
    const lines = fixtureLines("claude--select-menu.txt");
    const blocks = buildBlocks(lines, { agent: "codex" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("raw");
    expect(blocks.some((b) => b.kind === "prompt-select")).toBe(false); // NO menu lifting for codex
    expect(blocks[0]!.lines).toBe(lines); // untouched — same reference
  });

  // The hasBlockGrammar gate is provably per-adapter: the SAME menu-shaped buffer that Claude lifts
  // into a prompt-select stays a single raw block for a codex agent (above) AND for an unknown/absent
  // agent (below) — the universal fallback. No Claude-tuned matcher ever runs on them.
  it("leaves a menu-shaped buffer raw for an unknown/absent agent (universal fallback)", () => {
    const lines = fixtureLines("claude--select-menu.txt");
    const blocks = buildBlocks(lines, { agent: undefined });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("raw");
    expect(blocks.some((b) => b.kind === "prompt-select")).toBe(false);
    expect(blocks[0]!.lines).toBe(lines); // untouched — same reference
  });

  it("splits a multi-question wizard tail into [raw before, wizard] at the stepper header", () => {
    const lines = fixtureLines("claude--wizard-q2.txt");
    const blocks = buildBlocks(lines, { agent: "claude" });
    expect(blocks.map((b) => b.kind)).toEqual(["raw", "wizard"]);

    const raw = blocks[0]!;
    const wizard = blocks[1]!;
    if (raw.kind !== "raw" || wizard.kind !== "wizard") throw new Error("unexpected block kinds");
    // Everything from the stepper down is consumed into the wizard block; scrollback stays raw.
    expect(blockText(raw.lines)).not.toContain("What scope should this work have?");
    expect(wizard.wizard.phase).toBe("question");
    expect(blockText(wizard.lines)).toContain("Enter to select"); // the replaced footer lives here
  });

  it("lifts the Submit review step (which has no footer) into a wizard block too", () => {
    const blocks = buildBlocks(fixtureLines("claude--wizard-submit.txt"), { agent: "claude" });
    const wizard = blocks[blocks.length - 1]!;
    if (wizard.kind !== "wizard") throw new Error("expected a wizard tail block");
    expect(wizard.wizard.phase).toBe("review");
  });

  it("keeps a wizard buffer as pure raw for a non-Claude agent", () => {
    const lines = fixtureLines("claude--wizard-q1.txt");
    const blocks = buildBlocks(lines, { agent: "codex" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("raw");
    expect(blocks[0]!.lines).toBe(lines);
  });
});

describe("presentBlocks — agent neutrality (claude, grok, agy/undefined)", () => {
  it("yields identical presented raw lines across agents for neutral mirror output", () => {
    const rawBuffer = [
      "│ col 1      │ col 2      │",
      `╭${"─".repeat(40)}╮`,
      `┌${"─".repeat(40)}┐`,
      "Ordinary wrapping prose here.",
    ].join("\n");

    const parsed = parseAnsi(rawBuffer);
    const claudeBlocks = presentBlocks(buildBlocks(splitLines(parsed), { agent: "claude" }));
    const grokBlocks = presentBlocks(buildBlocks(splitLines(parsed), { agent: "grok" }));
    const agyBlocks = presentBlocks(buildBlocks(splitLines(parsed), { agent: undefined }));

    expect(claudeBlocks).toHaveLength(1);
    expect(grokBlocks).toHaveLength(1);
    expect(agyBlocks).toHaveLength(1);

    expect(claudeBlocks[0]!.lines).toEqual(grokBlocks[0]!.lines);
    expect(grokBlocks[0]!.lines).toEqual(agyBlocks[0]!.lines);

    const presentedLines = agyBlocks[0]!.lines;
    expect(presentedLines[0]!.noWrap).toBe(true);
    expect(presentedLines[1]!.noWrap).toBe(true);
    expect(presentedLines[2]!.noWrap).toBe(true);
    expect(presentedLines[3]!.noWrap).toBeUndefined();
  });

  it("applies the same highlight and trailing-strip presentation for claude and agy", () => {
    const rawBuffer = [
      `${ESC}[7mHighlighted header              ${ESC}[27m`,
      `${ESC}[41mPadded status                    ${ESC}[0m`,
      "Ordinary wrapping prose here.",
    ].join("\n");

    const parsed = parseAnsi(rawBuffer);
    const claudeBlocks = presentBlocks(buildBlocks(splitLines(parsed), { agent: "claude" }));
    const agyBlocks = presentBlocks(buildBlocks(splitLines(parsed), { agent: undefined }));

    expect(claudeBlocks[0]!.lines).toEqual(agyBlocks[0]!.lines);
    expect(claudeBlocks[0]!.lines[0]!.noWrap).toBeUndefined();
    expect(claudeBlocks[0]!.lines[0]!.segments[0]!.text).toBe("Highlighted header");
    expect(claudeBlocks[0]!.lines[1]!.noWrap).toBeUndefined();
    expect(claudeBlocks[0]!.lines[1]!.segments[0]!.text).toBe("Padded status");
    expect(claudeBlocks[0]!.lines[2]!.noWrap).toBeUndefined();
  });
});

