import { useNavigate, useRouteLoaderData } from "react-router";

import { AppHeader } from "@/components/app-header";
import { SessionSwitcher } from "@/components/session-switcher";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { AgentList } from "@/components/agent-list";
import { StatusArea } from "@/components/status-area";
import { BuildStamp } from "@/components/build-stamp";
import { UpdateBanner } from "@/components/update-banner";
import { useDashPrefs } from "@/hooks/use-dash-prefs";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { homePath, panePath } from "@/lib/nav";

// Herd — the home destination. The triaged herd and nothing else: Needs you → Ready · unseen →
// Working → Recent (see lib/triage.ts). Tapping an agent opens its pane. Spaces live behind their
// own bottom-bar tab (routes/spaces.tsx), so the dashboard is only ever "who needs me".
export function HomeRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  // A stalled load (a black-holed poll, or a pane-open tap whose navigation hangs) gallops the
  // Collie mark within the threshold — instant feedback while you're still on the dashboard, even
  // though the tap otherwise shows no visual change until its loader finally settles or times out.
  const stalled = useLoadingStalled();
  const navigate = useNavigate();
  const { prefs, setRecentOpen, setRecentDir } = useDashPrefs();

  // `from` is where the pane's "‹" returns to. Without it the pane falls back to its space, which
  // is right when you drilled in via Spaces but wrong from Herd — two back-taps would strand you on
  // the Spaces list, a screen you never visited, while the phone's own back gesture went to Herd.
  const open = (id: string) =>
    navigate(panePath(id, data.session), { state: { from: homePath(data.session) } });

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col">
      {/* The dashboard header: wordmark + the session switcher (dashboard-only). Settings moved to
          the bottom bar. The switcher self-hides on a single-session install. */}
      <AppHeader
        bridge={data.bridge}
        error={data.error}
        stalled={stalled}
        wordmark
        rightLead={<SessionSwitcher sessions={data.sessions ?? []} current={data.session} />}
      />

      {/* Content region below the header: a viewport-clipped internal scroller. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ReadOnlyBanner device={data.device} />

        <main className="flex-1">
          <AgentList
            agents={data.agents}
            bridge={data.bridge}
            onOpen={open}
            recentDir={prefs.recentDir}
            onRecentDirChange={setRecentDir}
            recentOpen={prefs.recentOpen}
            onRecentOpenChange={setRecentOpen}
          />
        </main>

        {/* An available update / needed restart, then the build stamp (which bundle you're
            running, with a stale-cache nudge). */}
        <UpdateBanner className="px-3 pt-3" />
        <BuildStamp className="px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)_+_0.5rem)]" />
      </div>

      {/* Status overlay, floating above the bottom bar (no input here) — same slim line, floating so
          it never shifts the list. Stays outside the scroller so it never scrolls away. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-screen-sm px-3 pb-[calc(env(safe-area-inset-bottom)_+_4rem)]">
        <StatusArea />
      </div>
    </div>
  );
}
