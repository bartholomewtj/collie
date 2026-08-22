// Resume the last screen after Android relaunches the installed app at start_url.
//
// "Open in browser" on a file opens a Chrome tab outside the PWA window. If Android drops the PWA
// process while you read it, swiping back relaunches Collie at "/" (the manifest start_url) — you
// land on the dashboard instead of the folder you left. Nothing in the page survives that, so the
// last in-app path is kept in localStorage and, on a cold launch at exactly "/" within a short
// window of the last save, the URL is rewritten before the router boots. replaceState, not push: the
// dashboard is not left as a phantom entry behind you.
const KEY = "collie:last-path";
const WINDOW_MS = 10 * 60 * 1000;

export function rememberPath(path: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Storage may be unavailable (private mode, quota) — resuming is a nicety, not a contract.
  }
}

/** Returns the path to resume at, or null. Pure so the boot rule is unit-testable. */
export function resumePath(current: string, now: number, raw: string | null): string | null {
  if (current !== "/") return null;
  if (!raw) return null;
  try {
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof path !== "string" || typeof at !== "number") return null;
    if (!path.startsWith("/") || path === "/" || now - at > WINDOW_MS) return null;
    return path;
  } catch {
    return null;
  }
}

/** Call once before the router is created. A reload (type "reload") or a back/forward restore must
 *  NOT be redirected — only a fresh navigation to the bare start_url is a relaunch. */
export function resumeOnBoot(): void {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav && nav.type !== "navigate") return;
    const current = window.location.pathname + window.location.search;
    const target = resumePath(current, Date.now(), localStorage.getItem(KEY));
    if (target) window.history.replaceState(null, "", target);
  } catch {
    // see rememberPath
  }
}
