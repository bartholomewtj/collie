import type { AgentStatus, TranscriptEntry, TranscriptPart } from "./types";

// Where the transcript ends and the live mirror begins.
//
// An agent pane stacks two views of the SAME conversation: the parsed session log above the "Live"
// divider, and the terminal viewport below it. Nothing stopped them overlapping, and between turns
// they always do — the viewport still holds the tail of the turn the transcript just rendered, so
// the newest message reads twice (once as markdown, once as raw terminal). This finds the seam and
// cuts the transcript there, so each line of the conversation appears exactly once.
//
// When the newest transcript turn is already on screen and the TUI has nothing to tap or stream,
// the live tail is the worse copy of that turn — hide it and leave the markdown. liveMirrorNeeded
// is that decision; newestTurnInViewport is the "journal has caught the viewport" half of it.
//
// Matching is fuzzy by necessity. The terminal hard-wraps to the pane width and renders markdown
// rather than echoing it, so the same sentence differs on the two sides by line breaks and by the
// syntax characters (backticks, asterisks, heading hashes) the renderer ate. So we compare
// whitespace-split tokens with those characters stripped, never raw strings.

/** Tokens that must match in a row before we believe it's the same passage, not a coincidence. */
export const SEAM_PROBE_TOKENS = 12;
/** How far into the mirror to keep re-probing. Its first rows are often tool output or a partial
 *  wrapped line — content the transcript never held — so the seam can sit some way in. */
const MAX_PROBE_OFFSET = 200;
/** Gap between probe start offsets. Small enough not to step over a short overlap. */
const PROBE_STEP = 4;
/** Only the transcript's tail can hold the seam: the mirror is one viewport (~50 rows). Capping the
 *  search keeps this cheap enough to run on every poll. */
const SEARCH_TAIL_TOKENS = 3000;

/** Markdown syntax and box glyphs that the terminal renders away rather than printing. */
const NOISE = /[`*_~#>|•\u2500-\u257f]/g;

function normalise(raw: string): string {
  return raw.toLowerCase().replace(NOISE, "");
}

/** Whitespace-split `text`, normalised; empty tokens (pure syntax) are dropped. */
function words(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const w = normalise(raw);
    if (w) out.push(w);
  }
  return out;
}

/** One transcript token, carrying where it came from so a match can be cut at exactly that point. */
interface Token {
  word: string;
  entry: number;
  part: number;
  /** Character offset of the token inside its part's text. */
  start: number;
}

/**
 * Tokens from the tail of the transcript, oldest-first. Only `text` parts contribute: a tool part's
 * summary is Collie's own wording, and thinking is usually collapsed in the terminal — neither can
 * be matched against the mirror, and including them would break otherwise-contiguous runs.
 */
function tailTokens(entries: TranscriptEntry[]): Token[] {
  const chunks: Token[][] = [];
  let count = 0;
  for (let i = entries.length - 1; i >= 0 && count < SEARCH_TAIL_TOKENS; i--) {
    const chunk: Token[] = [];
    const parts = entries[i]!.parts;
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p]!;
      if (part.kind !== "text") continue;
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(part.text)) !== null) {
        const word = normalise(m[0]);
        if (word) chunk.push({ word, entry: i, part: p, start: m.index });
      }
    }
    chunks.unshift(chunk);
    count += chunk.length;
  }
  return chunks.flat();
}

/** The point in the transcript where the mirror's content starts, or null if they don't overlap. */
export interface Seam {
  entry: number;
  part: number;
  /** Character offset into that part's text. */
  char: number;
}

/**
 * Find where `mirrorText` (the live viewport, ANSI already stripped) picks the transcript up.
 *
 * Probes run from the front of the mirror inwards and the first that lands wins, so the seam is the
 * earliest mirror content the transcript also holds. Within a probe the LAST transcript match wins:
 * a stock phrase can recur, and the copy on screen is the most recent one.
 */
export function findSeam(entries: TranscriptEntry[], mirrorText: string): Seam | null {
  const mirror = words(mirrorText);
  const tokens = tailTokens(entries);
  if (mirror.length <= SEAM_PROBE_TOKENS || tokens.length < SEAM_PROBE_TOKENS) return null;

  // First word of every candidate run, so a probe checks a handful of positions instead of scanning.
  const byFirstWord = new Map<string, number[]>();
  for (let i = 0; i <= tokens.length - SEAM_PROBE_TOKENS; i++) {
    const at = byFirstWord.get(tokens[i]!.word);
    if (at) at.push(i);
    else byFirstWord.set(tokens[i]!.word, [i]);
  }

  // Start at 1, not 0: the viewport can open part-way through a wrapped line, so its first token may
  // be a word fragment that matches nothing. Leaving that one token un-deduped costs a line at most.
  const lastOffset = Math.min(MAX_PROBE_OFFSET, mirror.length - SEAM_PROBE_TOKENS);
  for (let off = 1; off <= lastOffset; off += PROBE_STEP) {
    const candidates = byFirstWord.get(mirror[off]!);
    if (!candidates) continue;
    for (let c = candidates.length - 1; c >= 0; c--) {
      const at = candidates[c]!;
      let hit = true;
      for (let k = 1; k < SEAM_PROBE_TOKENS; k++) {
        if (tokens[at + k]!.word !== mirror[off + k]) {
          hit = false;
          break;
        }
      }
      if (!hit) continue;
      // Probes step in fours, and the real overlap can start before the one that landed. Walk back
      // while the two still agree so the cut sits on the first shared token, not up to three in.
      let start = at;
      let back = off;
      while (start > 0 && back > 0 && tokens[start - 1]!.word === mirror[back - 1]) {
        start--;
        back--;
      }
      return { entry: tokens[start]!.entry, part: tokens[start]!.part, char: tokens[start]!.start };
    }
  }
  return null;
}

/**
 * Drop the tail of `entries` that the live mirror already shows, cutting mid-message where the seam
 * falls inside one. Returns `entries` itself (same reference) when there is no overlap, so callers
 * can rely on identity.
 */
export function trimAtSeam(entries: TranscriptEntry[], mirrorText: string): TranscriptEntry[] {
  const seam = findSeam(entries, mirrorText);
  if (!seam) return entries;

  const kept = entries.slice(0, seam.entry);
  const entry = entries[seam.entry]!;
  const parts: TranscriptPart[] = entry.parts.slice(0, seam.part);
  const cut = entry.parts[seam.part];
  if (cut?.kind === "text") {
    const head = cut.text.slice(0, seam.char).trimEnd();
    // No `truncated` marker: the rest isn't lost, it's the first thing under the Live divider.
    if (head) parts.push({ kind: "text", text: head });
  }
  if (parts.length > 0) kept.push({ ...entry, parts });
  return kept;
}

/**
 * True when the live viewport is showing the newest transcript turn (the one the journal most
 * recently wrote), not an older one still sitting at the top of the 50-row window.
 *
 * Hide-live uses this as the safety latch: if the newest turn is not on screen, the TUI is still
 * the only copy of what just happened (journal lag, or a turn still streaming), so the tail stays.
 * A last turn that is only tool parts never matches — those are Collie's summaries, not screen
 * text — and the tail stays for the same reason.
 */
export function newestTurnInViewport(entries: TranscriptEntry[], mirrorText: string): boolean {
  if (entries.length === 0) return false;
  const last = entries.length - 1;
  if (!entries[last]!.parts.some((p) => p.kind === "text" && p.text.trim() !== "")) return false;
  const seam = findSeam(entries, mirrorText);
  return seam !== null && seam.entry === last;
}

/** Inputs to {@link liveMirrorNeeded}. Kept as a type so the pane and the tests share one shape. */
export interface LiveMirrorNeed {
  kind?: "agent" | "shell";
  status?: AgentStatus;
  dialogPresent: boolean;
  rawTerminal: boolean;
  findOpen: boolean;
  hasTranscript: boolean;
  newestTurnInViewport: boolean;
  pinned: boolean;
}

/**
 * Whether the pane should paint the live terminal tail.
 *
 * Always on for a shell (the terminal IS the conversation), a dialog (the buttons live in the
 * tail), a working/blocked/unknown agent (tokens and "needs you" are only on the TUI), find-in-
 * output (it searches the buffer), raw-terminal (the operator asked for the TUI), or a pin (they
 * tapped Show live). Off only when an idle/done agent pane has the newest turn in the transcript
 * already — then the tail is a worse copy of the markdown above it.
 */
export function liveMirrorNeeded(opts: LiveMirrorNeed): boolean {
  if (opts.pinned) return true;
  if (opts.rawTerminal) return true;
  if (opts.findOpen) return true;
  if (opts.kind === "shell") return true;
  if (!opts.hasTranscript) return true;
  if (opts.dialogPresent) return true;
  const status = opts.status ?? "unknown";
  if (status === "working" || status === "blocked" || status === "unknown") return true;
  return !opts.newestTurnInViewport;
}
