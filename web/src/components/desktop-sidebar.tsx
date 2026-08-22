import { useState } from "react";
import { Activity, Folder, LayoutGrid, Settings } from "lucide-react";
import { useLocation, useNavigate, useRevalidator } from "react-router";
import { cn } from "@/lib/utils";
import { SpaceTree } from "@/components/space-tree";
import { SessionSwitcher } from "@/components/session-switcher";
import { homePath, tracesPath, filesPath, settingsPath } from "@/lib/nav";
import type { HomeData } from "@/lib/loaders";
import { isReadOnly } from "@/lib/types";
import { useSpaceActions } from "@/hooks/use-spaces";
import { NewSpaceSheet } from "@/components/new-space-sheet";

export function DesktopSidebar({ data, currentPaneId }: { data: HomeData; currentPaneId?: string }) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { pathname } = useLocation();
  const { newSpace, newTab } = useSpaceActions();
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const items = [
    { label: "Spaces", icon: LayoutGrid, to: homePath(data.session), active: pathname === "/" },
    ...(data.workspaces.some((w) => w.sssf) ? [{ label: "Traces", icon: Activity, to: tracesPath(data.session), active: pathname.startsWith("/traces") }] : []),
    ...(data.files ? [{ label: "Files", icon: Folder, to: filesPath(data.session), active: pathname.startsWith("/files") }] : []),
    { label: "Settings", icon: Settings, to: settingsPath(data.session), active: pathname === "/settings" },
  ];
  return <aside className="flex min-h-0 flex-col border-r-2 border-border bg-muted">
    <div className="flex items-center justify-between border-b border-border p-3"><span className="font-semibold">Collie</span><SessionSwitcher sessions={data.sessions ?? []} current={data.session} /></div>
    <div className="min-h-0 flex-1 overflow-y-auto"><SpaceTree workspaces={data.workspaces} tabs={data.tabs} agents={data.agents} shellPanes={data.shellPanes} onNewSpace={() => setNewSpaceOpen(true)} onNewTab={newTab} onRenamed={() => revalidator.revalidate()} session={data.session} readOnly={isReadOnly(data.device)} currentPaneId={currentPaneId} error={data.error} lastSeenAt={data.lastSeenAt} /></div>
    <nav aria-label="Desktop navigation" className="border-t-2 border-border p-2">{items.map((item) => <button key={item.label} type="button" aria-current={item.active ? "page" : undefined} onClick={() => navigate(item.to)} className={cn("flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm", item.active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50")}><item.icon className="size-4" />{item.label}</button>)}</nav>
    <NewSpaceSheet open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} onCreate={newSpace} />
  </aside>;
}
