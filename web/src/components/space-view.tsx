import { useState } from "react";

import { TabActionsSheet } from "@/components/tab-actions-sheet";
import { useLongPress } from "@/hooks/use-long-press";
import { groupPanesByTab } from "@/lib/spaces";
import type { AgentView, TabView, WorkspaceView } from "@/lib/types";
import { AgentCard } from "./agent-card";

interface TabHeadingProps {
  label: string;
  /** The tab these actions target; undefined for the synthetic orphan group (heading stays inert). */
  onLongPress?: () => void;
}

// The per-tab section heading in the "All" view. With the actions wired it is a long-pressable
// button that opens the same rename/close sheet the tab chips do; without them (or for the orphan
// group, which has no tab record) it stays a plain heading. A plain tap is deliberately a no-op:
// there is no "active" tab in this list, so a tap has nothing to mean.
function TabHeading({ label, onLongPress }: TabHeadingProps) {
  const longPress = useLongPress(onLongPress);
  const cls = "px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  if (!onLongPress) return <h3 className={cls}>{label}</h3>;
  return (
    <h3 className={cls}>
      <button
        type="button"
        aria-label={`Tab ${label} actions`}
        {...longPress}
        // select-none + -webkit-touch-callout:none stop iOS Safari's selection loupe, whose native
        // long-press gesture otherwise fires pointercancel and kills the hold timer. Deliberately NO
        // touch-action:none — the list has to keep scrolling; a scroll cancels the hold instead.
        className="select-none text-left uppercase [-webkit-touch-callout:none]"
      >
        {label}
      </button>
    </h3>
  );
}

interface SpaceViewProps {
  workspace: WorkspaceView;
  tabs: TabView[];
  agents: AgentView[];
  shellPanes: AgentView[];
  /** Selected tab id, or null for "All" (every tab as a labelled section). */
  selectedTab: string | null;
  onOpen: (paneId: string) => void;
  /** Session scope for the long-press tab actions (rename/close); undefined = primary. */
  session?: string;
  /** Drop the long-press write actions when the device isn't authorised (the sheet shows a note). */
  readOnly?: boolean;
  /** Revalidate after a rename. Long-press headings turn on only when this AND onClosed are set. */
  onRenamed?: () => void;
  /** Refresh/fall back after a close. Enables long-press together with onRenamed. */
  onClosed?: (tabId: string) => void;
}

// One space's panes, grouped by tab (agents AND bare shells). Tab selection + creation live in the
// TabStrip header row above; here we render either the selected tab's panes, or every tab as a
// labelled section when "All" is active. A long-press on a tab section heading opens the tab
// actions sheet (rename / close) when the parent wires both onRenamed and onClosed. A
// freshly-created tab's shell shows up here so you can open it and launch your own agent.
export function SpaceView({
  workspace,
  tabs,
  agents,
  shellPanes,
  selectedTab,
  onOpen,
  session,
  readOnly,
  onRenamed,
  onClosed,
}: SpaceViewProps) {
  const [sheetTab, setSheetTab] = useState<TabView | null>(null);
  const actionsEnabled = !!onRenamed && !!onClosed;
  const tabById = new Map(tabs.map((t) => [t.tabId, t]));

  const allGroups = groupPanesByTab(workspace.workspaceId, tabs, agents, shellPanes);
  const groups = selectedTab ? allGroups.filter((g) => g.tabId === selectedTab) : allGroups;

  return (
    <>
      <div className="flex flex-col gap-5 px-3 py-4">
        {/* No space heading here — the route header names the space and carries its counts. */}
        {groups.map((g) => {
          const tab = tabById.get(g.tabId);
          return (
            <section key={g.tabId} className="flex flex-col gap-2">
              {selectedTab === null && (
                <TabHeading
                  label={g.label}
                  onLongPress={
                    actionsEnabled && tab ? () => setSheetTab(tab) : undefined
                  }
                />
              )}
              {g.panes.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">(empty tab)</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* scope="tab": this list already sits under its space heading and per-tab section,
                      so the cards lead with each pane's own name rather than repeating both. */}
                  {g.panes.map((p) => (
                    <AgentCard
                      key={p.paneId}
                      agent={p}
                      onClick={() => onOpen(p.paneId)}
                      scope="tab"
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {groups.length === 0 && (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">
            {selectedTab ? "This tab has no panes." : "This space has no panes."}
          </p>
        )}
      </div>

      {actionsEnabled && onRenamed && onClosed && (
        <TabActionsSheet
          open={sheetTab !== null}
          onClose={() => setSheetTab(null)}
          tab={sheetTab}
          session={session}
          readOnly={readOnly}
          onRenamed={onRenamed}
          onClosed={onClosed}
        />
      )}
    </>
  );
}
