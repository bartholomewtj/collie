import { cn } from "@/lib/utils";
import type { WorkspaceView } from "@/lib/types";

/**
 * The SSSF traces tab — a Collie-only virtual tab (no Herdr pane behind it) that shows the Super
 * Simple Software Factory visualiser for the workspace's repo. The bridge serves the visualiser under
 * /sssf/ (bridge/sssf-viz.ts) and stamps each workspace with `sssf` when its repo has ADW traces.
 *
 * Two pieces: the chip for the tab strip, and the frame that fills the pane area when it's selected.
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

interface SssfFrameProps {
  workspace: WorkspaceView;
  sssf: NonNullable<WorkspaceView["sssf"]>;
  /** Herdr session scope of the snapshot (undefined = primary), so the bridge keys the right workspace. */
  session: string | undefined;
  /** Hidden-but-mounted while another tab is selected, so the run being watched survives a switch. */
  hidden: boolean;
}

/** The iframe URL: the workspace (and session) pick the db; `t` is the per-boot token that lets the
 *  bridge accept this sandboxed frame's `Origin: null` on its read routes; `embed` compacts the UI. */
export function sssfFrameSrc(workspaceId: string, token: string, session: string | undefined): string {
  const q = new URLSearchParams({ ws: workspaceId, t: token, embed: "1" });
  if (session) q.set("session", session);
  return `/sssf/?${q.toString()}#/`;
}

// To send the frame back to its sessions list, the parent remounts it (a new React `key`) — a URL
// change on OUR side; nothing calls into the sandbox.
export function SssfFrame({ workspace, sssf, session, hidden }: SssfFrameProps) {
  return (
    <iframe
      title={`SSSF traces — ${workspace.label}`}
      src={sssfFrameSrc(workspace.workspaceId, sssf.token, session)}
      // No allow-same-origin: the visualiser runs at an opaque origin and cannot call Collie's own
      // /api/* with our cookies/identity. Its reads go to /sssf/api/* with the token above.
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={cn("h-full w-full border-0 bg-[#06080f]", hidden && "hidden")}
    />
  );
}
