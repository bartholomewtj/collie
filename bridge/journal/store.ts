// Reads + caches parsed journals, for whichever adapter the pane's agent selects.
//
// History is fetched ON DEMAND (it is not on the 1.5 s poll path), so the cost that matters is the
// repeat visit, not the first — a parse is reused until the log's size or mtime moves. The cache is
// keyed by absolute path, which is why one store can serve every agent and every herdr session at
// once: two sessions fronting panes whose agents write into the same root still hit the same entry.

import type { AgentSessionRef, JournalAdapter, TranscriptEntry, TranscriptPage } from "./types.ts";

/** How many parsed journals to keep hot. Each is re-parsed only when its file's size/mtime moves. */
const CACHE_MAX = 4;

interface CacheEntry {
  size: number;
  mtimeMs: number;
  complete: boolean;
  entries: TranscriptEntry[];
}

/**
 * Page a parsed journal, newest-anchored: with no cursor you get the LAST `limit` turns (the phone
 * opens at the recent end, like the mirror it replaces); `before` walks backwards from a turn you
 * already hold. Returned entries stay oldest-first so the view renders top-down either way.
 */
export function pageEntries(
  entries: TranscriptEntry[],
  opts: { limit: number; before?: string },
): { window: TranscriptEntry[]; hasMore: boolean } {
  // An unknown cursor (log rewritten under us, a stale client, or a synthesised cursor whose row
  // fell out of the window) degrades to "newest", never to an empty page — the user asked for older
  // history and must still see something.
  const end =
    opts.before === undefined
      ? entries.length
      : (() => {
          const i = entries.findIndex((e) => e.uuid === opts.before);
          return i === -1 ? entries.length : i;
        })();
  const start = Math.max(0, end - opts.limit);
  return { window: entries.slice(start, end), hasMore: start > 0 };
}

/** True when the NEWEST entry holds a tool call whose result hasn't been written yet — the
 *  agent is mid-command. Only the newest entry counts: results fold into the same entry
 *  (claude/pi mutate in place) or arrive as later rows, so anything older is settled. */
export function newestEntryPendingTool(entries: TranscriptEntry[]): boolean {
  if (entries.length === 0) return false;
  const last = entries[entries.length - 1]!;
  return last.parts.some((p) => p.kind === "tool" && p.result === undefined);
}

export class TranscriptStore {
  private readonly cache = new Map<string, CacheEntry>();

  private async loadEntry(
    adapter: JournalAdapter,
    path: string,
    meta: { size: number; mtimeMs: number },
  ): Promise<CacheEntry> {
    const cached = this.cache.get(path);
    if (cached && cached.size === meta.size && cached.mtimeMs === meta.mtimeMs) {
      // Re-set to move it to the end: eviction below is insertion-ordered, so touching a hit keeps
      // the hot journal from being evicted underneath a colder one.
      this.cache.delete(path);
      this.cache.set(path, cached);
      return cached;
    }
    const { text, complete, size, mtimeMs } = await adapter.source.load(path);
    const entry: CacheEntry = { size, mtimeMs, complete, entries: adapter.parse(text) };
    this.cache.set(path, entry);
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return entry;
  }

  /**
   * Read one page of a pane's journal.
   *
   * Null means "nothing to serve" for every reason the client is allowed to distinguish: the ref
   * names no file, the adapter refused the ref's shape, or the path failed containment. Those stay
   * indistinguishable on purpose — a containment failure must not be probeable.
   */
  async page(
    adapter: JournalAdapter,
    ref: AgentSessionRef,
    opts: { limit: number; before?: string },
  ): Promise<Omit<TranscriptPage, "paneId"> | null> {
    const path = await adapter.source.resolve(ref);
    if (path === null) return null;

    // Cache check BEFORE the read: a journal can be 32 MB and paging walks the same file repeatedly,
    // so validity is decided by a stat. Only a moved size/mtime costs a read + parse.
    const meta = await adapter.source.stat(path);
    if (meta === null) return null; // vanished between resolve and read

    const entry = await this.loadEntry(adapter, path, meta);
    const { entries, complete } = entry;

    const { window, hasMore } = pageEntries(entries, opts);
    return {
      entries: window,
      // A clipped file always has more behind it, even at the window's start.
      hasMore: hasMore || (!complete && window.length > 0 && window[0] === entries[0]),
      total: entries.length,
      fileTruncated: !complete,
    };
  }

  /**
   * True when the newest parsed turn holds a pending tool call; false when it doesn't; null when
   * there is nothing to read (no log / refused ref / containment miss) — the caller omits the
   * flag for null, exactly like `page()` returning null.
   */
  async runningCommand(adapter: JournalAdapter, ref: AgentSessionRef): Promise<boolean | null> {
    const path = await adapter.source.resolve(ref);
    if (path === null) return null;

    const meta = await adapter.source.stat(path);
    if (meta === null) return null;

    const entry = await this.loadEntry(adapter, path, meta);
    return newestEntryPendingTool(entry.entries);
  }
}
