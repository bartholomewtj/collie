import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useRevalidator, useRouteLoaderData } from "react-router";

import { AppHeader } from "@/components/app-header";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { SpaceView } from "@/components/space-view";
import { TabStrip } from "@/components/tab-strip";
import { StatusArea } from "@/components/status-area";
import { BuildStamp } from "@/components/build-stamp";
import { UpdateBanner } from "@/components/update-banner";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { useSpaceActions } from "@/hooks/use-spaces";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath, spacesPath } from "@/lib/nav";
import { setStatus } from "@/lib/status";
import { isReadOnly } from "@/lib/types";

// Space detail route: one space's tabs + panes. Shares the root snapshot (no own loader), reading
// :spaceId from the URL — deep-linkable. Native stack shape: the header's "‹" goes up one level to
// the Spaces list; the title names the space; the tab chips filter its panes. Sibling spaces are
// one back-tap away, not a second chip row over this one.
export function SpaceRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const { spaceId = "" } = useParams();
  const stalled = useLoadingStalled();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { newTab } = useSpaceActions();

  // Tab selection is ephemeral view state (no deep-link need). Reset it when the space changes:
  // navigating /space/a → /space/b does NOT remount this route (same element, new param), so without
  // this the prior space's tab id would leak across. Adjusting during render keeps it in sync with
  // no effect / no extra paint.
  const [tab, setTab] = useState<string | null>(null);
  const [tabSpace, setTabSpace] = useState(spaceId);
  if (tabSpace !== spaceId) {
    setTabSpace(spaceId);
    setTab(null);
  }

  const selectedWs = data.workspaces.find((w) => w.workspaceId === spaceId);

  const back = () => navigate(spacesPath(data.session));
  const open = (id: string) => navigate(panePath(id, data.session));

  // Recover from a deleted space: once a healthy snapshot no longer has it, bounce to the Spaces
  // list instead of leaving you on an empty shell. Guarded on a connected, non-stale snapshot so a
  // transient poll failure or a reconnect doesn't evict a still-valid one. Mirrors DetailRoute's
  // closed-pane recovery. Tell "closed under you" apart from "deep-link that never resolved".
  const gone = !selectedWs;
  const everExisted = useRef(false);
  if (selectedWs) everExisted.current = true;
  useEffect(() => {
    if (gone && data.bridge === "connected" && !data.error) {
      setStatus(everExisted.current ? "Space closed" : "Space not found", "info");
      navigate(spacesPath(data.session), { replace: true });
    }
  }, [gone, data.bridge, data.error, data.session, navigate]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col">
      <AppHeader bridge={data.bridge} error={data.error} stalled={stalled} onBack={back}>
        {selectedWs && (
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold leading-tight">{selectedWs.label}</div>
            <div className="truncate text-xs leading-tight text-muted-foreground">
              {selectedWs.tabCount} {selectedWs.tabCount === 1 ? "tab" : "tabs"} ·{" "}
              {selectedWs.paneCount} {selectedWs.paneCount === 1 ? "pane" : "panes"}
            </div>
          </div>
        )}
      </AppHeader>

      {/* Content region below the header: the viewport-clipped scroller. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ReadOnlyBanner device={data.device} />

        {selectedWs && (
          <>
            <TabStrip
              workspaceId={selectedWs.workspaceId}
              tabs={data.tabs}
              agents={data.agents}
              selected={tab}
              onSelect={setTab}
              onNewTab={newTab}
              session={data.session}
              readOnly={isReadOnly(data.device)}
              onRenamed={() => revalidator.revalidate()}
              // Closing the tab you're filtered to would strand you on an empty view — fall back to
              // "All" (setTab(null)) in that case; either way revalidate so it drops out of the strip.
              onClosed={(tabId) => {
                if (tab === tabId) setTab(null);
                revalidator.revalidate();
              }}
            />
            <main className="flex-1">
              <SpaceView
                workspace={selectedWs}
                tabs={data.tabs}
                agents={data.agents}
                shellPanes={data.shellPanes}
                selectedTab={tab}
                onOpen={open}
                session={data.session}
                readOnly={isReadOnly(data.device)}
                onRenamed={() => revalidator.revalidate()}
                onClosed={(tabId) => {
                  if (tab === tabId) setTab(null);
                  revalidator.revalidate();
                }}
              />
            </main>
          </>
        )}

        <UpdateBanner className="px-3 pt-3" />
        <BuildStamp className="px-3 pt-3 pb-3" />
      </div>

      {/* Status overlay, floating above the bottom bar. Stays outside the scroller. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-screen-sm px-3 pb-[calc(env(safe-area-inset-bottom)_+_4rem)]">
        <StatusArea />
      </div>
    </div>
  );
}
