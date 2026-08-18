// Chrome stripping for the Grok Build TUI. Peels the full-width composer box (and the hint row
// under it) off the tail so Collie does not wrap those 200-column `─` borders into a wall of
// lines on a phone. Tightens the remaining transcript rows: Grok right-aligns timestamps by
// padding every line to the terminal width, and that pad also wraps into a huge empty gap.
//
// Conservative: the box has to match as a whole at the tail. Unsure → return the buffer untouched
// (same reference), which is the T1 raw-mirror fallback.

import type { StyledLine } from "../../blocks";
import {
  bottomLabel,
  isActivityRow,
  isBlank,
  isBoxBody,
  isComposerBottom,
  isComposerTop,
  isHintRow,
  isPromptRow,
  lineText,
  promptDraft,
  rstrip,
} from "./markers";

// Wrapped-draft rows inside the box. Same defence-in-depth idea as Claude's MAX_DRAFT_LINES:
// every row the walk crosses counts, so a wall of lookalike `│ … │` transcript cannot pair a
// distant top border with the tail for free.
const MAX_DRAFT_LINES = 40;

export interface ComposerBox {
  top: number;
  prompt: number;
  bottom: number;
  /** Exclusive end of chrome: one past the hint row, or one past the bottom border. */
  chromeEnd: number;
}

export function locateComposer(lines: StyledLine[]): ComposerBox | null {
  const texts = lines.map((l) => rstrip(lineText(l)));
  let end = texts.length;
  while (end > 0 && isBlank(texts[end - 1]!)) end--;
  if (end === 0) return null;

  // Optional shortcut legend under the box.
  if (isHintRow(texts[end - 1]!)) {
    end--;
    while (end > 0 && isBlank(texts[end - 1]!)) end--;
    if (end === 0) return null;
  }

  if (!isComposerBottom(texts[end - 1]!)) return null;
  const bottom = end - 1;
  let i = bottom - 1;
  let walked = 0;
  let prompt = -1;

  while (i >= 0 && walked < MAX_DRAFT_LINES) {
    const row = texts[i]!;
    if (isComposerTop(row)) break;
    if (isBlank(row)) {
      walked++;
      i--;
      continue;
    }
    if (!isBoxBody(row)) return null;
    if (isPromptRow(row)) prompt = i;
    walked++;
    i--;
  }
  if (i < 0 || !isComposerTop(texts[i]!) || prompt < 0) return null;

  return { top: i, prompt, bottom, chromeEnd: lines.length };
}

/**
 * Drop trailing blanks, the composer box, the hint row, and the blank run above the box.
 * Then tighten remaining rows so right-aligned timestamps don't wrap into empty space.
 */
export function stripChrome(lines: StyledLine[]): StyledLine[] {
  const texts = lines.map((l) => rstrip(lineText(l)));
  let end = lines.length;
  while (end > 0 && isBlank(texts[end - 1]!)) end--;
  if (end === 0) return lines.length === 0 ? lines : lines.slice(0, 0);

  const box = locateComposer(lines);
  if (box !== null) {
    end = box.top;
    while (end > 0 && isBlank(texts[end - 1]!)) end--;
    // The activity row sits just above the box while Grok is working — peel it here; it is
    // re-surfaced by extractStatusLines.
    if (end > 0 && isActivityRow(texts[end - 1]!)) {
      end--;
      while (end > 0 && isBlank(texts[end - 1]!)) end--;
    }
  }

  const kept = end === lines.length ? lines : lines.slice(0, end);
  const tightened = kept.map(tightenLine);
  const changed =
    tightened.length !== lines.length || tightened.some((line, i) => line !== lines[i]);
  return changed ? tightened : lines;
}

export function extractStatusLines(lines: StyledLine[]): StyledLine[] {
  const box = locateComposer(lines);
  if (box === null) return [];

  const out: StyledLine[] = [];
  const texts = lines.map((l) => rstrip(lineText(l)));
  let i = box.top - 1;
  while (i >= 0 && isBlank(texts[i]!)) i--;
  if (i >= 0 && isActivityRow(texts[i]!)) {
    out.push(tightenLine(lines[i]!));
  }
  const label = bottomLabel(texts[box.bottom]!);
  if (label) {
    out.push({
      segments: [{ text: label, style: {}, muted: false }],
    });
  }
  return out;
}

export function extractInputDraft(lines: StyledLine[]): string | null {
  const box = locateComposer(lines);
  if (box === null) return null;
  const parts: string[] = [];
  const head = promptDraft(lineText(lines[box.prompt]!));
  if (head === null) return null;
  if (head.length > 0) parts.push(head);
  for (let j = box.prompt + 1; j < box.bottom; j++) {
    const t = rstrip(lineText(lines[j]!));
    const inner = t.replace(/^\s*│/, "").replace(/│\s*$/, "").trim();
    if (inner.length > 0) parts.push(inner);
  }
  const draft = parts.join(" ").trim();
  return draft.length === 0 ? null : draft;
}

export function hasComposer(lines: StyledLine[]): boolean {
  return locateComposer(lines) !== null;
}

/** The hint row if present, else the bottom border — both sit at the tail. */
export function composerPrompt(lines: StyledLine[]): string | null {
  const box = locateComposer(lines);
  if (box === null) return null;
  const texts = lines.map((l) => rstrip(lineText(l)));
  let end = texts.length;
  while (end > 0 && isBlank(texts[end - 1]!)) end--;
  if (end === 0) return null;
  return texts[end - 1] ?? null;
}

/**
 * Collapse Grok's right-aligned pad (timestamp / counters) so wrap does not invent empty rows.
 * Leaves ordinary prose and short gaps alone.
 */
export function tightenText(text: string): string {
  let t = rstrip(text);
  t = t.replace(/^(.*?)\s{8,}(\S.{0,40})$/, (_all, left: string, right: string) => {
    return `${left.replace(/\s+$/, "")}  ${right}`;
  });
  return t;
}

function tightenLine(line: StyledLine): StyledLine {
  const original = lineText(line);
  const next = tightenText(original);
  if (next === original) return line;
  return { segments: [{ text: next, style: line.segments[0]?.style ?? {}, muted: false }] };
}
