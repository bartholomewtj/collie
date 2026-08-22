import { Outlet, useParams } from "react-router";
import { setDesktop } from "@/lib/desktop";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import { useRouteLoaderData } from "react-router";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { useDesktopHotkeys } from "@/hooks/use-desktop-hotkeys";

export function DesktopShell() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const { paneId } = useParams();
  useDesktopHotkeys({ agents: data.agents, currentPaneId: paneId, session: data.session });
  return <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
    <div className="col-span-2 flex h-8 items-center border-b-2 border-border bg-accent px-3 text-xs font-medium">Desktop mode is on · <button type="button" className="ml-1 underline" onClick={() => setDesktop(false)}>Turn off</button></div>
    <DesktopSidebar data={data} currentPaneId={paneId} />
    <div className="min-w-0 min-h-0"><Outlet /></div>
  </div>;
}
