import { useState } from "react";
import { cn } from "@/lib/utils";
import type { WorkspaceView } from "@/lib/types";

/**
 * The SSSF traces frame — the Super Simple Software Factory visualiser for one repo, shown full
 * screen by the Traces destination (routes/traces.tsx). The bridge serves the visualiser under
 * /sssf/ (bridge/sssf-viz.ts) and stamps each workspace with `sssf` when a repo near it has ADW
 * traces; the Traces list flattens those into one row per repo.
 */

/** The SSSF mark: three swim lanes (same as the visualiser's own logo). Used by the Traces list. */
export function LanesIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect x="4" y="6" width="17" height="5" rx="2.5" fill="#e8b64a" />
      <rect x="8" y="13.5" width="20" height="5" rx="2.5" fill="#c89bff" />
      <rect x="4" y="21" width="13" height="5" rx="2.5" fill="#5ad2dd" />
    </svg>
  );
}

interface SssfFrameProps {
  workspace: WorkspaceView;
  sssf: NonNullable<WorkspaceView["sssf"]>;
  /** Herdr session scope of the snapshot (undefined = primary), so the bridge keys the right workspace. */
  session: string | undefined;
  /** Which repo's traces to show — a name from `sssf.repos`. Undefined = the bridge's attached repo. */
  repo: string | undefined;
  /** Open on this run's lanes instead of the sessions list. Read once, at mount. */
  adwId?: string;
  /** Hidden-but-mounted (kept for callers that park the frame); the Traces screen never hides it. */
  hidden?: boolean;
}

/** The iframe URL: the workspace (and session, and repo name) pick the db; `t` is the per-boot token
 *  that lets the bridge accept this sandboxed frame's `Origin: null` on its read routes; `embed`
 *  compacts the UI. The hash is the visualiser's own route: `#/` list, `#/<adwId>` one run's lanes. */
export function sssfFrameSrc(
  workspaceId: string,
  token: string,
  session: string | undefined,
  repo?: string,
  adwId?: string,
): string {
  const q = new URLSearchParams({ ws: workspaceId, t: token, embed: "1" });
  if (session) q.set("session", session);
  if (repo) q.set("repo", repo);
  return `/sssf/?${q.toString()}#/${adwId ? encodeURIComponent(adwId) : ""}`;
}

// To send the frame back to its sessions list, or to another repo, the parent remounts it (a new
// React `key`) — a URL change on OUR side; nothing calls into the sandbox. The run to open on is
// pinned at mount: a later snapshot naming a newer run must not yank a frame someone is reading.
export function SssfFrame({ workspace, sssf, session, repo, adwId, hidden }: SssfFrameProps) {
  const [openOn] = useState(adwId);
  return (
    <iframe
      title={`SSSF traces — ${workspace.label}`}
      src={sssfFrameSrc(workspace.workspaceId, sssf.token, session, repo, openOn)}
      // No allow-same-origin: the visualiser runs at an opaque origin and cannot call Collie's own
      // /api/* with our cookies/identity. Its reads go to /sssf/api/* with the token above.
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={cn("h-full w-full border-0 bg-[#06080f]", hidden && "hidden")}
    />
  );
}
