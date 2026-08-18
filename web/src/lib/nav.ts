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

/** The Spaces list — the bottom bar's second destination; a space's back button lands here. */
export function spacesPath(session?: string): string {
  return `/spaces${sessionSearch(session)}`;
}

/** The Traces list (every SSSF repo the bridge found, across spaces) — the bottom bar's Traces tab. */
export function tracesPath(session?: string): string {
  return `/traces${sessionSearch(session)}`;
}

/** One repo's trace visualiser, full screen. The workspace picks the db on the bridge; the repo is a
 *  name from that workspace's `sssf.repos` (never a path). `pane` scopes the screen to the runs that
 *  pane launched (its Traces button; back then returns to the pane), `adw` opens on one run. */
export function tracePath(
  spaceId: string,
  repo: string,
  session?: string,
  scope: { pane?: string; adw?: string } = {},
): string {
  const q = new URLSearchParams(sessionSearch(session));
  if (scope.pane) q.set("pane", scope.pane);
  if (scope.adw) q.set("adw", scope.adw);
  const search = q.toString();
  return `/traces/${encodeURIComponent(spaceId)}/${encodeURIComponent(repo)}${search ? `?${search}` : ""}`;
}

/** The dashboard path, carrying the current session so "go home" doesn't drop you back to primary. */
export function homePath(session?: string): string {
  return `/${sessionSearch(session)}`;
}

/** The settings route, carrying the current session like the other path helpers. */
export function settingsPath(session?: string): string {
  return `/settings${sessionSearch(session)}`;
}
