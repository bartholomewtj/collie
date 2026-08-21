// Grok Build's journal adapter.
//
// SHAPE OF THE SOURCE (verified against ~/.grok/sessions on 2026-08-17, grok 1.0.4):
//   ~/.grok/sessions/<encodeURIComponent(cwd)>/<session-uuid>/chat_history.jsonl
//   {"type":"system","content":"…"}                                              ← identity, dropped
//   {"type":"user","content":[{type:"text",text:"<user_query>…</user_query>"}],
//    "prompt_index":N}
//   {"type":"user","content":[…],"synthetic_reason":"system_reminder"}           ← injected, dropped
//   {"type":"reasoning","id":"rs_…","summary":[{type:"summary_text",text:"…"}]}  ← dropped
//   {"type":"assistant","content":"…","tool_calls":[{id,name,arguments}]}
//   {"type":"tool_result","tool_call_id":"…","content":"…"}
//
// Real user speech is wrapped in <user_query>. The first user row is the injected <user_info> +
// rules blob; synthetic_reason rows are skills/MCP reminders. Neither is something the operator
// typed, so both are dropped. Reasoning rows are the model's private scratch (often encrypted) —
// the spoken reply is on the following assistant row.
//
// Rows have no stable id of their own (except reasoning, which we drop), so the paging cursor is
// synthesised from the row bytes — same job, same failure mode as Codex (journal/codex.ts).
//
// HOW THE SESSION IS NAMED. Herdr has no grok integration as of this writing, so a grok pane
// arrives with no agent_session. The adapter therefore also implements inferFromCwd. Logs live
// at `~/.grok/sessions/<encodeURIComponent(cwd)>/<uuid>/`, so every grok tab in one space shares
// a directory. "Newest session under that cwd" is only safe when THIS pane is the only grok pane
// there. When several tabs share the cwd, we match the live viewport / terminal title against
// each session's last user turns (and remember the bind) instead of handing every tab the same
// newest log.

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { containedRealpath, exists, loadTail, rootList, statFile } from "./files.ts";
import { clamp, MAX_RESULT_CHARS, MAX_TEXT_CHARS, stripAnsi, summarizeToolInput } from "./text.ts";
import type {
  AgentSessionRef,
  InferSessionOpts,
  JournalAdapter,
  TranscriptEntry,
  TranscriptPart,
  TranscriptSource,
} from "./types.ts";

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOG_NAME = "chat_history.jsonl";

export function isGrokSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

/** Stable per-row cursor. Grok rows carry no id we render, so this is a property of the bytes. */
export function grokCursor(line: string, seen: Map<string, number>): string {
  let hash = 5381;
  for (let i = 0; i < line.length; i++) hash = ((hash << 5) + hash + line.charCodeAt(i)) | 0;
  const key = (hash >>> 0).toString(36);
  const n = seen.get(key) ?? 0;
  seen.set(key, n + 1);
  return n === 0 ? `gx-${key}` : `gx-${key}-${n}`;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string"
        ? (b as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Pull the words the operator typed out of a user row. Null means drop the row.
 *
 * Only about a third of user rows are speech: the rest are the injected workspace/rules blob or
 * a synthetic reminder. Rendering those as "You" would be wrong.
 */
export function extractGrokUserSpeech(raw: string): string | null {
  const text = stripAnsi(raw).trim();
  if (text === "") return null;
  if (
    text.startsWith("<user_info>") ||
    text.startsWith("<system-reminder>") ||
    text.startsWith("<rules>") ||
    text.startsWith("<always_applied_workspace_rules")
  ) {
    return null;
  }
  const tagged = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/.exec(text);
  if (tagged) {
    const inner = (tagged[1] ?? "").trim();
    return inner === "" ? null : inner;
  }
  return text;
}

/** Collapse whitespace so a TUI-wrapped user line still matches the journal query. */
export function foldGrokHint(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Last spoken user turns in a Grok log, newest first. Walks from the end so a tail-read
 * (partial first line) still yields the queries on screen now.
 */
export function lastGrokUserQueries(text: string, n = 3): string[] {
  const found: string[] = [];
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0 && found.length < n; i--) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    let row: GrokRow;
    try {
      row = JSON.parse(line) as GrokRow;
    } catch {
      continue;
    }
    if (row.type !== "user" || typeof row.synthetic_reason === "string") continue;
    const speech = extractGrokUserSpeech(contentText(row.content));
    if (speech !== null) found.push(speech);
  }
  return found;
}

const MIN_TITLE_CHARS = 8;
const MIN_QUERY_CHARS = 12;
const QUERY_PREFIX_CHARS = 80;

/** How well a live pane hint (viewport + title) matches a session's title and last user turns. */
export function scoreGrokHint(foldedHint: string, title: string | null, queries: string[]): number {
  if (foldedHint === "") return 0;
  let score = 0;
  if (title) {
    const t = foldGrokHint(title);
    if (t.length >= MIN_TITLE_CHARS && foldedHint.includes(t)) score += 1000 + t.length;
  }
  for (const q of queries) {
    const f = foldGrokHint(q);
    if (f.length >= MIN_QUERY_CHARS && foldedHint.includes(f)) {
      score += f.length;
      continue;
    }
    if (f.length >= 24) {
      const prefix = f.slice(0, QUERY_PREFIX_CHARS);
      if (foldedHint.includes(prefix)) score += prefix.length;
    }
  }
  return score;
}

function parseToolArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { command: raw };
  }
}

interface GrokRow {
  type?: unknown;
  content?: unknown;
  synthetic_reason?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
}

/**
 * Parse a Grok chat_history.jsonl into oldest-first turns. PURE — no fs, no clock.
 *
 * Unparseable lines are skipped: the log is appended to live, so the last line can be a partial
 * write, and a tail-read window starts mid-line by construction.
 */
export function parseGrokTranscript(text: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const pendingTools = new Map<string, Extract<TranscriptPart, { kind: "tool" }>>();
  const seen = new Map<string, number>();

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let row: GrokRow;
    try {
      row = JSON.parse(line) as GrokRow;
    } catch {
      continue;
    }
    const uuid = grokCursor(line, seen);

    if (row.type === "user") {
      if (typeof row.synthetic_reason === "string") continue;
      const speech = extractGrokUserSpeech(contentText(row.content));
      if (speech === null) continue;
      entries.push({
        uuid,
        ts: "",
        role: "user",
        parts: [{ kind: "text", ...clamp(speech, MAX_TEXT_CHARS) }],
      });
      continue;
    }

    if (row.type === "assistant") {
      const parts: TranscriptPart[] = [];
      const spoken = stripAnsi(typeof row.content === "string" ? row.content : contentText(row.content));
      if (spoken.trim() !== "") parts.push({ kind: "text", ...clamp(spoken, MAX_TEXT_CHARS) });
      if (Array.isArray(row.tool_calls)) {
        for (const raw of row.tool_calls) {
          if (!raw || typeof raw !== "object") continue;
          const tc = raw as { id?: unknown; name?: unknown; arguments?: unknown };
          const name = typeof tc.name === "string" ? tc.name : "tool";
          const part: Extract<TranscriptPart, { kind: "tool" }> = {
            kind: "tool",
            name,
            summary: summarizeToolInput(parseToolArgs(tc.arguments)),
          };
          parts.push(part);
          if (typeof tc.id === "string" && tc.id !== "") pendingTools.set(tc.id, part);
        }
      }
      if (parts.length === 0) continue;
      entries.push({ uuid, ts: "", role: "assistant", parts });
      continue;
    }

    if (row.type === "tool_result") {
      const id = typeof row.tool_call_id === "string" ? row.tool_call_id : "";
      const resultText = stripAnsi(contentText(row.content));
      const target = pendingTools.get(id);
      if (target) {
        pendingTools.delete(id);
        target.result = clamp(resultText, MAX_RESULT_CHARS);
      } else if (resultText.trim() !== "") {
        entries.push({
          uuid,
          ts: "",
          role: "assistant",
          parts: [{ kind: "tool", name: "tool", summary: "", result: clamp(resultText, MAX_RESULT_CHARS) }],
        });
      }
    }
  }
  return entries;
}

function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export class GrokTranscriptSource implements TranscriptSource {
  private readonly pathCache = new Map<string, string>();
  /** paneId → the session we last bound it to, so a later poll doesn't guess newest. */
  private readonly paneBind = new Map<string, { cwd: string; sessionId: string }>();
  private readonly roots: string[];

  constructor(roots: string | readonly string[]) {
    this.roots = rootList(roots);
  }

  async resolve(ref: AgentSessionRef): Promise<string | null> {
    if (ref.kind === "path") {
      const candidate = ref.value.endsWith(LOG_NAME) ? ref.value : join(ref.value, LOG_NAME);
      for (const root of this.roots) {
        const real = await containedRealpath(candidate, root);
        if (real !== null) return real;
      }
      return null;
    }
    if (!isGrokSessionId(ref.value)) return null;
    const sessionId = ref.value;
    const cached = this.pathCache.get(sessionId);
    if (cached !== undefined) {
      if (await exists(cached)) return cached;
      this.pathCache.delete(sessionId);
    }

    for (const root of this.roots) {
      let cwdDirs: string[];
      try {
        cwdDirs = await readdir(root);
      } catch {
        continue;
      }
      for (const dir of cwdDirs) {
        const candidate = join(root, dir, sessionId, LOG_NAME);
        if (!(await exists(candidate))) continue;
        const real = await containedRealpath(candidate, root);
        if (real === null) break;
        this.pathCache.set(sessionId, real);
        return real;
      }
    }
    return null;
  }

  /**
   * Pick the session for a grok pane when Herdr named none.
   *
   * One grok pane at this cwd → newest session, same as before. Several grok panes at this cwd
   * (tabs in one space) → match the live hint against each session's last user turns; never hand
   * every tab the same newest log. A bind is remembered per paneId so a later poll without a hint
   * still returns this pane's session.
   */
  async inferFromCwd(cwdOrOpts: string | InferSessionOpts): Promise<AgentSessionRef | null> {
    const opts: InferSessionOpts = typeof cwdOrOpts === "string" ? { cwd: cwdOrOpts } : cwdOrOpts;
    if (opts.cwd.trim() === "") return null;
    const want = normalizeCwd(opts.cwd);
    for (const root of this.roots) {
      const sessionDir = await this.cwdDir(root, opts.cwd, want);
      if (sessionDir === null) continue;
      const listed = await listSessionIds(sessionDir);
      if (listed.length === 0) continue;

      if (!opts.sharedCwd) {
        const id = listed[0]!.id;
        if (opts.paneId) this.paneBind.set(opts.paneId, { cwd: want, sessionId: id });
        return { kind: "id", value: id };
      }

      const cached = opts.paneId ? this.paneBind.get(opts.paneId) : undefined;
      const cacheHit =
        cached !== undefined &&
        cached.cwd === want &&
        listed.some((s) => s.id === cached.sessionId);

      const folded = opts.hint ? foldGrokHint(opts.hint) : "";
      if (folded !== "") {
        const ids = new Set(listed.slice(0, FINGERPRINT_SESSIONS).map((s) => s.id));
        if (cacheHit) ids.add(cached.sessionId);
        const ranked = await this.scoreSessions(
          sessionDir,
          listed.filter((s) => ids.has(s.id)),
          folded,
        );
        const best = uniqueBest(ranked);
        if (best !== null) {
          if (opts.paneId) {
            for (const [paneId, bind] of this.paneBind) {
              if (paneId !== opts.paneId && bind.cwd === want && bind.sessionId === best) {
                this.paneBind.delete(paneId);
              }
            }
            this.paneBind.set(opts.paneId, { cwd: want, sessionId: best });
          }
          return { kind: "id", value: best };
        }
      }

      if (cacheHit) return { kind: "id", value: cached.sessionId };
      // Several panes, no evidence this pane owns a session — do not guess newest.
      return null;
    }
    return null;
  }

  private async scoreSessions(
    sessionDir: string,
    listed: { id: string; mtimeMs: number }[],
    foldedHint: string,
  ): Promise<{ id: string; score: number }[]> {
    const out: { id: string; score: number }[] = [];
    for (const s of listed) {
      const title = await grokGeneratedTitle(sessionDir, s.id);
      const tail = await grokLogTail(sessionDir, s.id);
      const queries = tail === null ? [] : lastGrokUserQueries(tail, 3);
      out.push({ id: s.id, score: scoreGrokHint(foldedHint, title, queries) });
    }
    return out;
  }

  private async cwdDir(root: string, cwd: string, want: string): Promise<string | null> {
    const exact = join(root, encodeURIComponent(cwd));
    if (await exists(exact)) {
      const real = await containedRealpath(exact, root);
      if (real !== null) return real;
    }
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return null;
    }
    for (const name of names) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(name);
      } catch {
        continue;
      }
      if (normalizeCwd(decoded) !== want) continue;
      const real = await containedRealpath(join(root, name), root);
      if (real !== null) return real;
    }
    return null;
  }

  stat = statFile;
  load = loadTail;
}

/** How many of the newest sessions we fingerprint against a live pane. */
const FINGERPRINT_SESSIONS = 16;
/** Bytes of chat_history.jsonl we read from the end to recover the last user turns. */
const FINGERPRINT_TAIL_BYTES = 64 * 1024;

async function listSessionIds(sessionDir: string): Promise<{ id: string; mtimeMs: number }[]> {
  let names: string[];
  try {
    names = await readdir(sessionDir);
  } catch {
    return [];
  }
  const out: { id: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!isGrokSessionId(name)) continue;
    const log = join(sessionDir, name, LOG_NAME);
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(log);
    } catch {
      continue;
    }
    out.push({ id: name, mtimeMs: st.mtimeMs });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id));
  return out;
}

async function grokGeneratedTitle(sessionDir: string, id: string): Promise<string | null> {
  const candidate = join(sessionDir, id, "summary.json");
  const real = await containedRealpath(candidate, sessionDir);
  if (real === null) return null;
  try {
    const raw = await Bun.file(real).text();
    const parsed = JSON.parse(raw) as { generated_title?: unknown };
    return typeof parsed.generated_title === "string" && parsed.generated_title.trim() !== ""
      ? parsed.generated_title.trim()
      : null;
  } catch {
    return null;
  }
}

async function grokLogTail(sessionDir: string, id: string): Promise<string | null> {
  const candidate = join(sessionDir, id, LOG_NAME);
  const real = await containedRealpath(candidate, sessionDir);
  if (real === null) return null;
  try {
    const file = Bun.file(real);
    const size = file.size;
    return size <= FINGERPRINT_TAIL_BYTES
      ? await file.text()
      : await file.slice(size - FINGERPRINT_TAIL_BYTES).text();
  } catch {
    return null;
  }
}

function uniqueBest(ranked: { id: string; score: number }[]): string | null {
  let best: { id: string; score: number } | null = null;
  let tied = false;
  for (const r of ranked) {
    if (r.score <= 0) continue;
    if (best === null || r.score > best.score) {
      best = r;
      tied = false;
    } else if (r.score === best.score && r.id !== best.id) {
      tied = true;
    }
  }
  return best !== null && !tied ? best.id : null;
}

/** Grok's journal adapter. `agent` matches the Herdr snapshot's `agent` string. */
export function grokJournal(roots: string | readonly string[]): JournalAdapter {
  const source = new GrokTranscriptSource(roots);
  return {
    agent: "grok",
    source,
    parse: parseGrokTranscript,
    inferFromCwd: (cwd) => source.inferFromCwd(cwd),
  };
}
