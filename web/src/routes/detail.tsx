import { useEffect } from "react";
import { useLocation, useNavigate, useParams, useRouteLoaderData } from "react-router";

import { AgentChat } from "@/components/agent-chat";
import { setStatus } from "@/lib/status";
import { ROOT_ROUTE_ID, type HomeData, type PaneData } from "@/lib/loaders";
import { homePath, panePath } from "@/lib/nav";
import type { AgentView } from "@/lib/types";

// The full-screen terminal mirror + composer for one agent.
export function DetailRoute() {
  const { paneId = "" } = useParams();
  const root = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const navigate = useNavigate();
  const location = useLocation();

  // Read the active session from the live URL search (loader doesn't own it).
  const session = new URLSearchParams(location.search).get("s") ?? undefined;

  // Track the route the user came from (e.g. "/" or "/pane/xyz"). Stamped into router state by the
  // navigation that opened this pane.
  const from = (location.state as { from?: string } | null)?.from;

  // Bootstrap an agent record before the next snapshot poll lands:
  //  - when a new tab/pane was JUST created in the UI, the caller passes its optimistic AgentView in
  //    router state (`freshPane`).
  //  - we only use `freshPane` for the very pane it was created for, and only until that pane
  //    actually appears in a snapshot (once seen, a later absence means the pane was closed).
  const fresh = (location.state as { freshPane?: AgentView } | null)?.freshPane;
  const seenInSnapshot =
    root.agents.some((a) => a.paneId === paneId) ||
    root.shellPanes.some((p) => p.paneId === paneId);

  // Find the agent in the live snapshot — agents first, then bare shells. Fall back to the freshPane
  // state only while the pane has not yet appeared in any snapshot.
  const agent: AgentView | undefined =
    root.agents.find((a) => a.paneId === paneId) ??
    root.shellPanes.find((p) => p.paneId === paneId) ??
    (fresh && fresh.paneId === paneId && !seenInSnapshot ? fresh : undefined);
  const tabLabel = root.tabs.find((t) => t.tabId === agent?.tabId)?.label;
  const gone = !agent;

  // "Up" from a pane is where you came from when we know it (`from`), else home (the Spaces tree).
  const upPath = () => from ?? homePath(session);
  const up = () => navigate(upPath());

  // Recover from a closed pane: once a healthy snapshot no longer has it, bounce up to home
  // instead of leaving you on a dead "agent gone" view. Guarded on a connected, non-stale snapshot
  // so a transient poll failure or reconnect doesn't evict a still-valid pane.
  useEffect(() => {
    if (gone && root.bridge === "connected" && !root.error) {
      setStatus("Pane closed", "info");
      navigate(upPath(), { replace: true });
    }
  }, [gone, root.bridge, root.error, navigate, session, from]);

  return (
    <AgentChat
      key={paneId}
      paneId={paneId}
      session={session}
      agent={agent}
      tabLabel={tabLabel}
      agents={root.agents}
      shellPanes={root.shellPanes}
      device={root.device}
      onBack={up}
      onSelect={(id) => navigate(panePath(id, session), { state: { from } })}
      onClosed={up}
    />
  );
}
