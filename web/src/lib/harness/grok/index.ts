// The Grok Build TUI adapter. Tier 1 only: strip the full-width composer box (and tighten
// right-aligned transcript padding) so a phone wrap does not turn the box into a wall of lines.
// Emits no interactive block kind — a mis-parse costs cosmetics, not a keystroke.

import type { Block, StyledLine } from "../../blocks";
import type { HarnessAdapter } from "../types";
import {
  composerPrompt,
  extractInputDraft,
  extractStatusLines,
  hasComposer,
  stripChrome,
} from "./chrome";

export function grokBuildBlocks(lines: StyledLine[]): Block[] {
  return [{ kind: "raw", lines: stripChrome(lines) }];
}

export { extractStatusLines, extractInputDraft };

export const grokAdapter: HarnessAdapter = {
  agent: "grok",
  buildBlocks: grokBuildBlocks,
  extractStatusLines,
  extractInputDraft,
  composerReady: hasComposer,
  composerPrompt,
};
