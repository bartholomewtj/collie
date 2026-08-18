import { useState } from "react";
import { cn } from "@/lib/utils";
import type { WorkspaceView } from "@/lib/types";

/**
 * The SSSF traces tab — a Collie-only virtual tab (no Herdr pane behind it) that shows the Super
 * Simple Software Factory visualiser for the workspace's repo. The bridge serves the visualiser under
 * /sssf/ (bridge/sssf-viz.ts) and stamps each workspace with `sssf` when its repo has ADW traces.
 *
 * Three pieces: the chip for the tab strip, the frame that fills the pane area when it's selected,
 * and — when the bridge found more than one repo near the workspace's panes — a row of repo chips
 * above the frame to switch between them.
 */

/** Sentinel tab id for the space route's tab state — never a Herdr tab id. */
export const SSSF_TAB = "sssf:traces";

const SSSF_LABEL = "Traces";

/** The SSSF mark: three swim lanes (same as the visualiser's own logo). */
function LanesIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect x="4" y="6" width="17" height="5" rx="2.5" fill="#e8b64a" />
      <rect x="8" y="13.5" width="20" height="5" rx="2.5" fill="#c89bff" />
      <rect x="4" y="21" width="13" height="5" rx="2.5" fill="#5ad2dd" />
    </svg>
  );
}

interface SssfChipProps {
  sssf: NonNullable<WorkspaceView["sssf"]>;
  active: boolean;
  onSelect: () => void;
  /** Tapping the already-active chip: sends the frame back to its sessions list. */
  onTapActive?: () => void;
}

// Deliberately not the shared Chip: the leading mark is the whole point (it's what says "this is not
// a Herdr tab"), and Chip's leading slot is a triage dot with triage semantics. Same shape and fills.
export function SssfChip({ sssf, active, onSelect, onTapActive }: SssfChipProps) {
  const pending = sssf.state === "pending";
  return (
    <button
      type="button"
      disabled={pending}
      aria-current={active ? "true" : undefined}
      title={pending ? "No traces yet — run an ADW in this repo" : "SSSF traces for this repo"}
      onClick={() => (active && onTapActive ? onTapActive() : onSelect())}
      className={cn(
        "relative flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors active:scale-95",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/70",
        pending && "opacity-50",
      )}
    >
      <LanesIcon className={cn("size-3.5", pending && "grayscale")} />
      {SSSF_LABEL}
      {pending && <span className="sr-only"> (no traces yet)</span>}
    </button>
  );
}

type SssfRepo = NonNullable<WorkspaceView["sssf"]>["repos"][number];

interface SssfRepoRowProps {
  repos: SssfRepo[];
  selected: string;
  onSelect: (name: string) => void;
}

/** One chip per repo, the running one marked with a dot. Only rendered when there are several. */
export function SssfRepoRow({ repos, selected, onSelect }: SssfRepoRowProps) {
  return (
    <div role="tablist" aria-label="SSSF repos" className="flex shrink-0 gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
      {repos.map((r) => {
        const active = r.name === selected;
        const pending = r.state === "pending";
        return (
          <button
            key={r.name}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={pending}
            title={pending ? `${r.name}: no traces yet` : r.running ? `${r.name}: a run is live` : r.name}
            onClick={() => onSelect(r.name)}
            className={cn(
              "flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors active:scale-95",
              active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
              pending && "opacity-50",
            )}
          >
            {r.running && <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />}
            {r.name}
            {r.running && <span className="sr-only"> (running)</span>}
          </button>
        );
      })}
    </div>
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
  /** Hidden-but-mounted while another tab is selected, so the run being watched survives a switch. */
  hidden: boolean;
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
