import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, ChevronRight, FolderPlus, LayoutGrid, Plus, Search, WifiOff, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/section-header";
import { StatusDot } from "@/components/status-badge";
import { SpaceActionsSheet } from "@/components/space-actions-sheet";
import { TabActionsSheet } from "@/components/tab-actions-sheet";
import { PaneActionsSheet } from "@/components/pane-actions-sheet";
import { useLongPress } from "@/hooks/use-long-press";
import { useDashPrefs } from "@/hooks/use-dash-prefs";
import {
  filterSpaces,
  groupPanesByTab,
  spaceLastSeenMap,
  spaceTriageMap,
  worstBucket,
} from "@/lib/spaces";
import { TRIAGE_STATUS } from "@/lib/triage";
import { clockTime, timeAgo } from "@/lib/format";
import { panePath } from "@/lib/nav";
import { paneDisplayName, STATUS_LABEL } from "@/lib/types";
import type { AgentView, TabView, WorkspaceView } from "@/lib/types";

interface TreeRowButtonProps {
  onClick?: () => void;
  onLongPress?: () => void;
  className?: string;
  children: ReactNode;
  disabled?: boolean;
}

function TreeRowButton({
  onClick,
  onLongPress,
  className,
  children,
  disabled,
}: TreeRowButtonProps) {
  const longPress = useLongPress(onLongPress);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      {...longPress}
      className={cn(
        "flex min-w-0 flex-1 select-none flex-row items-center gap-2.5 text-left transition-transform [-webkit-touch-callout:none]",
        !disabled && "active:scale-[0.99]",
        disabled && "cursor-default",
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface SpaceTreeProps {
  workspaces: WorkspaceView[];
  tabs: TabView[];
  agents: AgentView[];
  shellPanes?: AgentView[];
  onNewSpace: () => void;
  onNewTab: (workspaceId: string) => void;
  session?: string;
  readOnly?: boolean;
  onRenamed?: () => void;
  /** The snapshot on screen is stale — an empty tree then means "we don't know", never "no spaces". */
  error?: boolean;
  lastSeenAt?: number;
}

export function SpaceTree({
  workspaces,
  tabs,
  agents,
  shellPanes = [],
  onNewSpace,
  onNewTab,
  session,
  readOnly,
  onRenamed,
  error = false,
  lastSeenAt,
}: SpaceTreeProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  const { prefs, setSpaceOpen, setTabOpen } = useDashPrefs();

  const [sheetSpace, setSheetSpace] = useState<WorkspaceView | null>(null);
  const [sheetTab, setSheetTab] = useState<TabView | null>(null);
  const [sheetPane, setSheetPane] = useState<AgentView | null>(null);

  const actionsEnabled = !!onRenamed;

  const panes = [...agents, ...shellPanes];
  // Single pass derivations
  const lastSeen = spaceLastSeenMap(panes);
  const worstBySpace = spaceTriageMap(agents);
  const blockedSpaces = [...worstBySpace.values()].filter((b) => b === "needs").length;

  // Fixed order: Herdr's workspace order, straight from the snapshot. No recency sort, no
  // blocked-first regroup — blocked state shows in place instead of lifting the row.
  const visible = filterSpaces(workspaces, query);

  function handleSpaceRowClick(
    w: WorkspaceView,
    tabGroups: ReturnType<typeof groupPanesByTab>,
    isSpaceExpanded: boolean,
  ) {
    if (tabGroups.length === 1) {
      const singleTab = tabGroups[0]!;
      if (singleTab.panes.length === 1) {
        navigate(panePath(singleTab.panes[0]!.paneId, session));
        return;
      } else if (singleTab.panes.length >= 2) {
        setSpaceOpen(w.workspaceId, true);
        setTabOpen(singleTab.tabId, true);
        return;
      } else {
        setSpaceOpen(w.workspaceId, !isSpaceExpanded);
        return;
      }
    } else {
      setSpaceOpen(w.workspaceId, !isSpaceExpanded);
    }
  }

  function handleTabRowClick(
    tabId: string,
    tabPanes: AgentView[],
    isTabExpanded: boolean,
  ) {
    if (tabPanes.length === 1) {
      navigate(panePath(tabPanes[0]!.paneId, session));
    } else if (tabPanes.length >= 2) {
      setTabOpen(tabId, !isTabExpanded);
    }
  }

  return (
    <section className="flex flex-col gap-2 px-3 py-4">
      <SectionHeader
        label="Spaces"
        count={query.trim() ? visible.length : workspaces.length}
        trailing={
          <>
            {blockedSpaces > 0 && (
              <span
                className="flex items-center gap-1 text-[11px] font-semibold tabular-nums text-status-blocked"
                aria-label={`${blockedSpaces} ${blockedSpaces === 1 ? "space needs" : "spaces need"} you`}
              >
                <span className="size-2 rounded-full bg-status-blocked" aria-hidden />
                {blockedSpaces}
              </span>
            )}
            {workspaces.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  if (filterOpen || query) {
                    setFilterOpen(false);
                    setQuery("");
                  } else {
                    setFilterOpen(true);
                  }
                }}
                aria-label="Filter spaces"
                aria-expanded={filterOpen}
                className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                {filterOpen || query ? <X className="size-4" /> : <Search className="size-4" />}
              </button>
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

      {filterOpen && (
        <label className="flex items-center gap-2 rounded-xl border-2 border-foreground bg-card px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter spaces…"
            aria-label="Filter spaces"
            className="min-h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      )}

      <div id="spaces-body" className="flex flex-col divide-y divide-border/60">

        {workspaces.length === 0 ? (
          error ? (
            <p className="flex items-center justify-center gap-2 px-1 py-6 text-center text-sm text-muted-foreground">
              <WifiOff className="size-4" />
              {lastSeenAt === undefined
                ? "Disconnected"
                : `Disconnected — last seen ${clockTime(lastSeenAt)}`}
            </p>
          ) : (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">No spaces yet.</p>
          )
        ) : visible.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            No space matches “{query}”.
          </p>
        ) : (
          visible.map((w) => {
            const worstBucketKey = worstBySpace.get(w.workspaceId);
            const status = worstBucketKey ? TRIAGE_STATUS[worstBucketKey] : null;
            const blocked = worstBucketKey === "needs";
            const seen = lastSeen.get(w.workspaceId) ?? 0;

            const isSpaceExpanded = prefs.spaceOpen[w.workspaceId] ?? blocked;
            const wsTabGroups = isSpaceExpanded || w.paneCount > 0
              ? groupPanesByTab(w.workspaceId, tabs, agents, shellPanes)
              : [];

            return (
              <div
                key={w.workspaceId}
                className={cn(
                  "flex flex-col transition-colors",
                  !blocked && "hover:bg-muted/30",
                )}
              >
                {/* Level 1: Space Row */}
                <div
                  className={cn(
                    "flex flex-row items-center gap-1 px-1.5 py-2",
                    blocked && "rounded-lg border border-status-blocked/40 bg-status-blocked/5",
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSpaceOpen(w.workspaceId, !isSpaceExpanded);
                    }}
                    aria-label={isSpaceExpanded ? `Collapse space ${w.label}` : `Expand space ${w.label}`}
                    className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                  >
                    {isSpaceExpanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </button>

                  <TreeRowButton
                    onClick={() => handleSpaceRowClick(w, wsTabGroups, isSpaceExpanded)}
                    onLongPress={actionsEnabled ? () => setSheetSpace(w) : undefined}
                  >
                    {status ? (
                      <>
                        <StatusDot status={status} />
                        <span className="sr-only">{STATUS_LABEL[status]}</span>
                      </>
                    ) : (
                      <span className="size-2.5 shrink-0 rounded-full border border-muted-foreground/40" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{w.label}</span>
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
                  </TreeRowButton>
                </div>

                {/* Expanded space children */}
                {isSpaceExpanded && (
                  <div className="flex flex-col pb-1.5 pl-6">
                    {wsTabGroups.map((group) => {
                      const tabPanes = group.panes;
                      const tabBucketKey = worstBucket(tabPanes);
                      const tabStatus = tabBucketKey ? TRIAGE_STATUS[tabBucketKey] : null;
                      const isMultiPane = tabPanes.length >= 2;
                      const isEmptyTab = tabPanes.length === 0;

                      const isTabExpanded = isMultiPane && prefs.expandedTabs.includes(group.tabId);
                      const tabRecord = tabs.find((t) => t.tabId === group.tabId);

                      return (
                        <div key={group.tabId} className="flex flex-col">
                          {/* Level 2: Tab Row */}
                          <div className="flex flex-row items-center gap-1 py-1.5 pr-1.5">
                            {isMultiPane ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTabOpen(group.tabId, !isTabExpanded);
                                }}
                                aria-label={isTabExpanded ? `Collapse tab ${group.label}` : `Expand tab ${group.label}`}
                                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                              >
                                {isTabExpanded ? (
                                  <ChevronDown className="size-3.5" />
                                ) : (
                                  <ChevronRight className="size-3.5" />
                                )}
                              </button>
                            ) : (
                              <span className="size-6 shrink-0" />
                            )}

                            <TreeRowButton
                              disabled={isEmptyTab}
                              onClick={() => handleTabRowClick(group.tabId, tabPanes, isTabExpanded)}
                              onLongPress={
                                actionsEnabled && tabRecord ? () => setSheetTab(tabRecord) : undefined
                              }
                            >
                              {tabStatus ? (
                                <>
                                  <StatusDot status={tabStatus} />
                                  <span className="sr-only">{STATUS_LABEL[tabStatus]}</span>
                                </>
                              ) : (
                                <span className="size-2 shrink-0 rounded-full border border-muted-foreground/40" />
                              )}
                              <span className="min-w-0 flex-1 truncate text-sm font-normal text-foreground">
                                {group.label}
                              </span>
                              {isEmptyTab && (
                                <span className="text-xs text-muted-foreground italic">
                                  (empty tab)
                                </span>
                              )}
                              {isMultiPane && (
                                <span className="text-xs tabular-nums text-muted-foreground">
                                  {tabPanes.length} panes
                                </span>
                              )}
                            </TreeRowButton>
                          </div>

                          {/* Level 3: Pane Rows (when multi-pane tab is expanded) */}
                          {isMultiPane && isTabExpanded && (
                            <div className="flex flex-col pl-7 pb-1">
                              {tabPanes.map((p) => {
                                const pStatus = p.status;
                                return (
                                  <div
                                    key={p.paneId}
                                    className="flex flex-row items-center gap-1 py-1 pr-1.5"
                                  >
                                    <TreeRowButton
                                      onClick={() => navigate(panePath(p.paneId, session))}
                                      onLongPress={
                                        actionsEnabled ? () => setSheetPane(p) : undefined
                                      }
                                    >
                                      <StatusDot status={pStatus} runningCommand={p.runningCommand} />
                                      <span className="sr-only">{STATUS_LABEL[pStatus]}</span>
                                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground hover:text-foreground">
                                        {paneDisplayName(p)}
                                      </span>
                                      {p.lastSeenAt ? (
                                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                          {timeAgo(p.lastSeenAt)}
                                        </span>
                                      ) : null}
                                    </TreeRowButton>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* New tab button */}
                    <div className="pt-2 pl-6">
                      <button
                        type="button"
                        onClick={() => onNewTab(w.workspaceId)}
                        aria-label="New tab"
                        className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent active:scale-95"
                      >
                        <Plus className="size-3.5" />
                        <span>New tab</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {actionsEnabled && (
        <>
          <SpaceActionsSheet
            open={sheetSpace !== null}
            onClose={() => setSheetSpace(null)}
            workspace={sheetSpace}
            session={session}
            readOnly={readOnly}
            onRenamed={onRenamed}
          />
          <TabActionsSheet
            open={sheetTab !== null}
            onClose={() => setSheetTab(null)}
            tab={sheetTab}
            session={session}
            readOnly={readOnly}
            onRenamed={onRenamed}
            onClosed={(tabId) => {
              setTabOpen(tabId, false);
              onRenamed();
            }}
          />
          <PaneActionsSheet
            open={sheetPane !== null}
            onClose={() => setSheetPane(null)}
            pane={sheetPane}
            session={session}
            readOnly={readOnly}
            onRenamed={onRenamed}
            onClosed={() => {
              onRenamed();
            }}
          />
        </>
      )}
    </section>
  );
}
