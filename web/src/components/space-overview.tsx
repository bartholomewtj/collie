import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { FolderPlus, LayoutGrid, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/section-header";
import { StatusDot } from "@/components/status-badge";
import { LanesIcon } from "@/components/sssf-frame";
import { SpaceActionsSheet } from "@/components/space-actions-sheet";
import { useLongPress } from "@/hooks/use-long-press";
import { filterSpaces, sortSpacesByRecency, spaceLastSeenMap, spaceTriageMap } from "@/lib/spaces";
import { TRIAGE_STATUS } from "@/lib/triage";
import { timeAgo } from "@/lib/format";
import { tracePath } from "@/lib/nav";
import { STATUS_LABEL } from "@/lib/types";
import type { AgentView, WorkspaceView } from "@/lib/types";

interface SpaceOverviewProps {
  workspaces: WorkspaceView[];
  agents: AgentView[];
  /** Bare shells too — a space you only ever opened a shell in still counts as used. */
  shellPanes?: AgentView[];
  onOpen: (workspaceId: string) => void;
  onNewSpace: () => void;
  /** Fold state, owned by the caller so it can be persisted. Omit both for a section that can't
   *  fold (the Spaces screen, where the list IS the page): always open, plain heading. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Herdr session scope of the snapshot (undefined = primary), so a traces link stays in-session. */
  session?: string;
  /** Drop the long-press rename when the device isn't authorised (the sheet shows a note). */
  readOnly?: boolean;
  /** Revalidate after a rename. The long-press space actions turn on only when this is set. */
  onRenamed?: () => void;
}

function SpaceRowButton({
  onOpen,
  onLongPress,
  children,
}: {
  onOpen: () => void;
  onLongPress?: () => void;
  children: ReactNode;
}) {
  const longPress = useLongPress(onLongPress);
  return (
    <button
      type="button"
      onClick={onOpen}
      {...longPress}
      // select-none + -webkit-touch-callout:none stop iOS Safari's selection loupe, whose native
      // long-press gesture otherwise fires pointercancel and kills the hold timer. Deliberately NO
      // touch-action:none — the spaces list must keep scrolling; a scroll cancels the hold instead.
      className="flex min-w-0 flex-1 select-none flex-row items-center gap-3 text-left transition-transform [-webkit-touch-callout:none] active:scale-[0.99]"
    >
      {children}
    </button>
  );
}

// The dashboard's navigator, and the LAST section on the page: everything you might act on comes
// first. It folds to a single line — with 45 spaces that's the difference between a dashboard and a
// scroll — and expands to a recency-ordered, filterable list.
export function SpaceOverview({
  workspaces,
  agents,
  shellPanes = [],
  onOpen,
  onNewSpace,
  open: openProp,
  onOpenChange,
  session,
  readOnly,
  onRenamed,
}: SpaceOverviewProps) {
  const navigate = useNavigate();
  const foldable = openProp !== undefined && !!onOpenChange;
  const open = foldable ? openProp : true;
  // Ephemeral view state, like SpaceRoute's tab selection — a filter you typed yesterday should not
  // greet you today with most of your spaces missing.
  const [query, setQuery] = useState("");
  const [sheetSpace, setSheetSpace] = useState<WorkspaceView | null>(null);
  // Inert without the callback — same pattern as TabStrip.actionsEnabled.
  const actionsEnabled = !!onRenamed;

  const panes = [...agents, ...shellPanes];
  // One pass over the panes, then map lookups — this component re-renders on every poll.
  const lastSeen = spaceLastSeenMap(panes);
  // One pass for "what's the most urgent thing in each space", shared with the chips so a row and a
  // chip can never mean different things by the same colour (lib/spaces.ts).
  const worstBySpace = spaceTriageMap(agents);
  const blockedSpaces = [...worstBySpace.values()].filter((b) => b === "needs").length;
  const visible = filterSpaces(sortSpacesByRecency(workspaces, panes, lastSeen), query);

  return (
    <section className="flex flex-col gap-2 px-3 py-4">
      <SectionHeader
        label="Spaces"
        // While filtering, the count reports what you can SEE — a header reading (45) above four
        // rows makes you doubt the filter rather than trust it.
        count={query.trim() ? visible.length : workspaces.length}
        open={foldable ? open : undefined}
        onToggle={foldable ? onOpenChange : undefined}
        controls={foldable ? "spaces-body" : undefined}
        trailing={
          <>
            {/* Why you'd bother expanding — stays visible while folded. */}
            {blockedSpaces > 0 && (
              <span
                className="flex items-center gap-1 text-[11px] font-semibold tabular-nums text-status-blocked"
                aria-label={`${blockedSpaces} ${blockedSpaces === 1 ? "space needs" : "spaces need"} you`}
              >
                <span className="size-2 rounded-full bg-status-blocked" aria-hidden />
                {blockedSpaces}
              </span>
            )}
            <button
              type="button"
              onClick={onNewSpace}
              aria-label="New space"
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
              <FolderPlus className="size-4" />
            </button>
          </>
        }
      />

      {open && (
        <div id="spaces-body" className="flex flex-col divide-y divide-border/60">
          {/* Deliberately NOT autofocused: on a phone that would throw the keyboard over the list
              you just asked to see. */}
          {/* Sticky: at 45 spaces the list is five screens, and a filter that scrolls away turns
              "wrong part of the list" into scroll-up, type, scroll-down. */}
          {workspaces.length > 1 && (
            <label className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter spaces…"
                aria-label="Filter spaces"
                // min-h-9 so the control itself clears the 36px touch floor, not just its padded label.
                className="min-h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          )}

          {workspaces.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">No spaces yet.</p>
          ) : visible.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              No space matches “{query}”.
            </p>
          ) : (
            visible.map((w) => {
              const bucket = worstBySpace.get(w.workspaceId);
              const status = bucket ? TRIAGE_STATUS[bucket] : null;
              const blocked = bucket === "needs";
              const seen = lastSeen.get(w.workspaceId) ?? 0;
              // A space's traces are worth a mark only when the bridge actually found a repo there.
              const sssf = w.sssf && w.sssf.repos.length > 0 ? w.sssf : null;
              // The repo the mark opens: the bridge's attached one, else the first it found (a NAME, never a path).
              const traceRepo = sssf ? (sssf.attached?.repo ?? sssf.repos[0].name) : null;
              // "Live" from the repos themselves; `sssf.attached?.adwId` agrees — the bridge only stamps that id
              // while the attached run is still going.
              const runLive = !!sssf?.repos.some((r) => r.running);
              return (
                <div
                  key={w.workspaceId}
                  className={cn(
                    // Square, like the herd rows: this is a divide-y list, and a rounded fill under
                    // a straight hairline reads as a fault. The blocked row below has a real border,
                    // so it keeps its radius.
                    "w-full transition-colors",
                    !blocked && "hover:bg-muted/50",
                  )}
                >
                  {/* Flat rows, not cards: these are single-line entries, so a card is 100% chrome
                      around one string, forty-five times. Card treatment is reserved for the agent
                      sections that mean "a human is required here". A blocked space still gets the
                      tint — that's the one cue worth the weight. */}
                  <div
                    className={cn(
                      "flex flex-row items-center gap-3 px-2.5 py-2.5",
                      blocked && "rounded-lg border border-status-blocked/40 bg-status-blocked/5",
                    )}
                  >
                    {/* The row's own tap target: everything but the lanes mark opens the space. */}
                    <SpaceRowButton
                      onOpen={() => onOpen(w.workspaceId)}
                      onLongPress={actionsEnabled ? () => setSheetSpace(w) : undefined}
                    >
                      {status ? (
                        <>
                          <StatusDot status={status} />
                          {/* The dot alone is colour-only; give SR users the status word. */}
                          <span className="sr-only">{STATUS_LABEL[status]}</span>
                        </>
                      ) : (
                        <span className="size-2.5 shrink-0 rounded-full border border-muted-foreground/40" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{w.label}</span>
                      {/* One count plus a relative time is what a 390px row has room for — the tab
                          count went, the pane count is the useful one. */}
                      <span
                        aria-label={`${w.paneCount} ${w.paneCount === 1 ? "pane" : "panes"}`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
                      >
                        <LayoutGrid className="size-3.5" aria-hidden />
                        {w.paneCount}
                      </span>
                      {seen > 0 && (
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {timeAgo(seen)}
                        </span>
                      )}
                    </SpaceRowButton>

                    {sssf && traceRepo && (
                      <button
                        type="button"
                        onClick={(e) => {
                          // The mark is a sibling of the row button, not nested in it — this is belt-and-braces
                          // against the row ever regaining an outer handler.
                          e.stopPropagation();
                          navigate(tracePath(w.workspaceId, traceRepo, session));
                        }}
                        aria-label={runLive ? "ADW runs in this space (one running)" : "ADW runs in this space"}
                        className="relative flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                      >
                        <LanesIcon className="size-4" />
                        {runLive && (
                          <span
                            aria-hidden="true"
                            className="absolute right-1 top-1 size-1.5 rounded-full bg-emerald-400 ring-2 ring-background"
                          />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {actionsEnabled && (
        <SpaceActionsSheet
          open={sheetSpace !== null}
          onClose={() => setSheetSpace(null)}
          workspace={sheetSpace}
          session={session}
          readOnly={readOnly}
          onRenamed={onRenamed}
        />
      )}
    </section>
  );
}
