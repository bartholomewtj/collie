import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesktopHotkeys } from "./use-desktop-hotkeys";
import { __resetDesktop, desktopPrefs, setDesktop, setTyping } from "@/lib/desktop";
import { onArmToggleRequest } from "@/lib/direct-arm";
import type { AgentView } from "@/lib/types";

const agent = (paneId: string, status: AgentView["status"]): AgentView => ({ paneId, workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t", agent: "claude", status, cwd: "/tmp", focused: false });
const agents = [agent("blocked", "blocked"), agent("working", "working")];
function Probe() { useDesktopHotkeys({ agents, currentPaneId: "blocked" }); return <output data-testid="path">{useLocation().pathname}</output>; }
function mount() { const router = createMemoryRouter([{ path: "*", element: <Probe /> }]); return render(<RouterProvider router={router} />); }
function dispatch(key: string, options: KeyboardEventInit = {}) { const e = new KeyboardEvent("keydown", { key, ctrlKey: true, cancelable: true, ...options }); act(() => window.dispatchEvent(e)); return e; }
beforeEach(() => { localStorage.clear(); __resetDesktop(); setDesktop(true); });
afterEach(() => { cleanup(); __resetDesktop(); });

describe("desktop arm hotkey", () => {
  it("switches composer to direct and requests arm", () => { const fn = vi.fn(); const off = onArmToggleRequest(fn); mount(); expect(dispatch("`").defaultPrevented).toBe(true); expect(desktopPrefs().typing).toBe("direct"); expect(fn).toHaveBeenCalledOnce(); off(); });
  it("requests again without changing direct", () => { setTyping("direct"); const fn = vi.fn(); const off = onArmToggleRequest(fn); mount(); dispatch("`"); expect(fn).toHaveBeenCalledOnce(); expect(desktopPrefs().typing).toBe("direct"); off(); });
  it("does not claim other chords", () => { const fn = vi.fn(); const off = onArmToggleRequest(fn); mount(); expect(dispatch("`", { shiftKey: true }).defaultPrevented).toBe(false); expect(dispatch("`", { altKey: true }).defaultPrevented).toBe(false); expect(dispatch("`", { ctrlKey: false }).defaultPrevented).toBe(false); expect(fn).not.toHaveBeenCalled(); off(); });
  it("unsubscribes with the hook", () => { const fn = vi.fn(); const off = onArmToggleRequest(fn); const { unmount } = mount(); off(); unmount(); expect(dispatch("`").defaultPrevented).toBe(false); });
  it("keeps pane navigation", () => { mount(); dispatch("ArrowDown", { altKey: true }); expect(screen.getByTestId("path")).toHaveTextContent(/working/); });
});
