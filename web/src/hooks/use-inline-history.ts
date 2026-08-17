import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { fetchHistory } from "@/lib/api";
import type { TranscriptEntry } from "@/lib/types";

// Last turns of a pane's transcript, loaded above the live mirror so a swipe up reads the
// conversation without leaving the pane. The dedicated history page stays for find / jump-to-turn.
//
// Small pages, not the history route's 5000-turn gulp: this sits on every pane open, and the live
// tail must paint first. Growing fetches the next page only when the reader reaches the top.

/** Turns fetched on pane open — a few screens, cheap enough to prefetch. */
export const INLINE_HISTORY_PAGE = 80;
/** Turns added per upward page. */
export const INLINE_HISTORY_STEP = 120;
/** Distance from the top of the scroller that triggers growth, in px. */
export const INLINE_GROW_THRESHOLD = 800;

export type InlineHistoryUnavailable = "disabled" | "no-session" | "no-log" | "error";

function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "name" in e && (e as { name?: unknown }).name === "AbortError";
}

export function useInlineHistory({
  paneId,
  session,
  enabled,
  getScrollElement,
}: {
  paneId: string;
  session?: string;
  enabled: boolean;
  getScrollElement: () => HTMLElement | null;
}) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<InlineHistoryUnavailable | undefined>();

  const loadingRef = useRef(false);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const pendingRestore = useRef(false);
  // First paint inserts above a following tail and must NOT re-anchor (the auto-scroller pins).
  // Later pages insert above a scrolled-up reader and must.
  const seeded = useRef(false);

  const captureAnchor = () => {
    const el = getScrollElement();
    anchor.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null;
    pendingRestore.current = true;
  };

  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      setHasMore(false);
      setUnavailable(undefined);
      seeded.current = false;
      return;
    }
    let cancelled = false;
    const ac = new AbortController();
    loadingRef.current = true;
    setLoading(true);
    fetchHistory(paneId, { limit: INLINE_HISTORY_PAGE }, session, ac.signal)
      .then((res) => {
        if (cancelled) return;
        if (!res.available) {
          setUnavailable(res.reason);
          setEntries([]);
          setHasMore(false);
          return;
        }
        setEntries(res.entries);
        setHasMore(res.hasMore);
        setUnavailable(undefined);
      })
      .catch((e) => {
        if (cancelled || isAbortError(e)) return;
        setUnavailable("error");
        setEntries([]);
        setHasMore(false);
      })
      .finally(() => {
        if (cancelled) return;
        loadingRef.current = false;
        setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
      loadingRef.current = false;
    };
  }, [enabled, paneId, session]);

  const loadOlder = useCallback(async () => {
    const oldest = entries[0]?.uuid;
    if (loadingRef.current || !hasMore || !oldest) return;
    captureAnchor();
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await fetchHistory(
        paneId,
        { limit: INLINE_HISTORY_STEP, before: oldest },
        session,
      );
      if (!res.available) {
        setHasMore(false);
        return;
      }
      setEntries((prev) => [...res.entries, ...prev]);
      setHasMore(res.hasMore);
    } catch (e) {
      if (!isAbortError(e)) setUnavailable("error");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [entries, getScrollElement, hasMore, paneId, session]);

  const growUpward = useCallback(() => {
    if (hasMore) void loadOlder();
  }, [hasMore, loadOlder]);

  useLayoutEffect(() => {
    if (!seeded.current) {
      if (entries.length > 0 || unavailable) seeded.current = true;
      return;
    }
    if (!pendingRestore.current) return;
    pendingRestore.current = false;
    const a = anchor.current;
    const el = getScrollElement();
    if (a && el) el.scrollTop = a.top + (el.scrollHeight - a.height);
    anchor.current = null;
  }, [entries, getScrollElement, unavailable]);

  return { entries, loading, hasMore, growUpward, unavailable };
}
