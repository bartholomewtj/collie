// Lexing helpers for the Grok Build TUI composer. Grok paints a rounded full-width box at the
// tail (`╭─╮` / `│ >` / `╰─╯`) and a key-hint row under it. Collie peels that chrome off so the
// phone mirror is the transcript, not a second copy of the input box. Predicates run on parsed
// line text (segment text joined), never raw ANSI.

import { isBlank, lineText } from "../../blocks";

export { isBlank, lineText };

/** Drop trailing whitespace only. Grok pads every row out to the terminal column count. */
export function rstrip(text: string): string {
  return text.replace(/[\s\u2588]+$/u, "");
}

// Two-space gutter, then a rounded box. Grok indents the composer (and the transcript) rather than
// drawing at column 0 — unlike omp — so the indent is part of the shape, not optional.
const TOP = /^\s*╭─+╮$/;
const BOTTOM = /^\s*╰─+[\s\S]*╯$/;
const PROMPT = /^\s*│\s*>/;
const SIDES = /^\s*│[\s\S]*│$/;
const HINT =
  /^\s*(?:Enter:send now|Shift\+Tab:mode|Esc:cancel)\b|^\s*.*\b(?:Enter:send now|Shift\+Tab:mode|Esc:cancel)\b.*│/;

export function isComposerTop(text: string): boolean {
  return TOP.test(rstrip(text));
}

export function isComposerBottom(text: string): boolean {
  return BOTTOM.test(rstrip(text));
}

export function isPromptRow(text: string): boolean {
  return PROMPT.test(rstrip(text));
}

/** A vertical-sided box row — the prompt line or a wrapped-draft continuation. */
export function isBoxBody(text: string): boolean {
  return SIDES.test(rstrip(text));
}

/** The shortcut legend Grok prints under the box. Collie has its own Keys pad. */
export function isHintRow(text: string): boolean {
  return HINT.test(rstrip(text));
}

/**
 * The in-box draft: everything after the leading `│ >` and before the closing `│`.
 * Empty / whitespace-only → "".
 */
export function promptDraft(text: string): string | null {
  const t = rstrip(text);
  const m = t.match(/^\s*│\s*>([\s\S]*?)│\s*$/);
  return m === null ? null : m[1]!.replace(/\s+$/, "").replace(/^\s/, "");
}

/** Model / mode label spliced into the bottom border, if any. */
export function bottomLabel(text: string): string {
  const t = rstrip(text);
  const m = t.match(/╰─+\s+(.+?)\s*─*╯$/);
  return m ? m[1]!.trim() : "";
}

/** The live activity row above the box (`| Read foo…  1m13s ↓134k [stop]`). */
export function isActivityRow(text: string): boolean {
  const t = rstrip(text);
  return /^\s+\|/.test(t) && /\[stop\]|Thinking|↓\d/.test(t);
}
