import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { triage } from "@/lib/triage";
import { panePath } from "@/lib/nav";
import { desktopPrefs, setTyping } from "@/lib/desktop";
import { isDirectArmed, requestArmToggle } from "@/lib/direct-arm";
import { requestFindOpen } from "@/lib/find-request";
import type { AgentView } from "@/lib/types";

export interface DesktopHotkeyArgs {
  agents: readonly AgentView[];
  currentPaneId?: string;
  session?: string;
}

export function useDesktopHotkeys({ agents, currentPaneId, session }: DesktopHotkeyArgs): void {
  const navigate = useNavigate();
  // Polls replace the snapshot while this one listener stays mounted. Keep the listener stable and
  // always consult the latest snapshot, otherwise a pane can disappear from the cycle until a
  // route remounts (and an unknown pane deliberately enters at the cycle's end).
  const latest = useRef({ agents, currentPaneId, session });
  latest.current = { agents, currentPaneId, session };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key === "`") {
        event.preventDefault();
        if (desktopPrefs().typing === "composer") setTyping("direct");
        requestArmToggle();
        return;
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && (event.key === "f" || event.key === "F")) {
        if (isDirectArmed() || latest.current.currentPaneId === undefined) return;
        event.preventDefault();
        requestFindOpen();
        return;
      }
      if (event.shiftKey || event.metaKey || !event.ctrlKey || !event.altKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const { agents: currentAgents, currentPaneId: current, session: currentSession } = latest.current;
      const ordered = triage(currentAgents).flatMap((section) => section.agents);
      if (ordered.length === 0) return;
      const index = ordered.findIndex((agent) => agent.paneId === current);
      const nextIndex = index < 0
        ? event.key === "ArrowDown" ? 0 : ordered.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + ordered.length) % ordered.length;
      const next = ordered[nextIndex];
      if (!next || next.paneId === current) return;
      event.preventDefault();
      navigate(panePath(next.paneId, currentSession));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [navigate]);
}
