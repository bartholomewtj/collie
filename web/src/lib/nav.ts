// Route path helpers. Pane ids contain a colon (e.g. "wE:p2"), so they must be URL-encoded in the
// path; React Router decodes them back in useParams. The active session rides along as `?s=` so a
// navigation stays scoped to the session you're viewing (see lib/session.ts) — omitted on primary.
import { sessionSearch } from "./session";

export function panePath(paneId: string, session?: string): string {
  return `/pane/${encodeURIComponent(paneId)}${sessionSearch(session)}`;
}

/**
 * A pane's conversation history — the agent's own transcript, which is the only scrollback a Claude
 * pane can have (its terminal runs on the alternate screen and retains nothing). A child path of the
 * pane so "back" lands on the live mirror.
 */
export function historyPath(paneId: string, session?: string): string {
  return `/pane/${encodeURIComponent(paneId)}/history${sessionSearch(session)}`;
}

/** A space's detail route (its tabs + panes). Deep-linkable; carries the session like panePath. */
export function spacePath(spaceId: string, session?: string): string {
  return `/space/${encodeURIComponent(spaceId)}${sessionSearch(session)}`;
}

/** Query param that opens a space straight on its Traces tab (see spaceTracesPath / routes/space.tsx). */
export const TRACES_PARAM = "tab";
export const TRACES_VALUE = "traces";
/** The pane the Traces tab was opened from — the space shows a "back to terminal" button for it. */
export const TRACES_FROM_PARAM = "from";

/** The space route with its Traces (SSSF) tab already open — how the pane view jumps to traces. */
export function spaceTracesPath(spaceId: string, session?: string, fromPaneId?: string): string {
  const base = spacePath(spaceId, session);
  const from = fromPaneId ? `&${TRACES_FROM_PARAM}=${encodeURIComponent(fromPaneId)}` : "";
  return `${base}${base.includes("?") ? "&" : "?"}${TRACES_PARAM}=${TRACES_VALUE}${from}`;
}

/** The dashboard path, carrying the current session so "go home" doesn't drop you back to primary. */
export function homePath(session?: string): string {
  return `/${sessionSearch(session)}`;
}

/** The settings route, carrying the current session like the other path helpers. */
export function settingsPath(session?: string): string {
  return `/settings${sessionSearch(session)}`;
}
