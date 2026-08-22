import { act, render, screen, cleanup } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { useDesktopHotkeys } from "./use-desktop-hotkeys";
import type { AgentView } from "@/lib/types";
import { panePath } from "@/lib/nav";

const agent = (paneId: string, status: AgentView["status"]): AgentView => ({
  paneId, workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t",
  agent: "claude", status, cwd: "/tmp", focused: false,
});
const agents = [agent("blocked", "blocked"), agent("working", "working"), agent("idle", "idle")];
function Probe({ currentPaneId, list = agents }: { currentPaneId?: string; list?: AgentView[] }) {
  useDesktopHotkeys({ agents: list, currentPaneId });
  return <output data-testid="pathname">{useLocation().pathname}</output>;
}
function mount(currentPaneId: string | undefined, list = agents) {
  const router = createMemoryRouter(
    [{ path: "*", element: <Probe currentPaneId={currentPaneId} list={list} /> }],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}
function dispatch(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, altKey: true, cancelable: true, ...options });
  act(() => { window.dispatchEvent(event); });
  return event;
}
afterEach(() => cleanup());

describe("useDesktopHotkeys", () => {
  it("navigates down and up in triage order, wrapping at both ends", () => {
    mount("blocked");
    expect(dispatch("ArrowDown").defaultPrevented).toBe(true);
    expect(screen.getByTestId("pathname")).toHaveTextContent(panePath("working"));
    cleanup();

    mount("working");
    dispatch("ArrowUp");
    expect(screen.getByTestId("pathname")).toHaveTextContent(panePath("blocked"));
    cleanup();

    mount("idle");
    dispatch("ArrowDown");
    expect(screen.getByTestId("pathname")).toHaveTextContent(panePath("blocked"));
    cleanup();

    mount("blocked");
    dispatch("ArrowUp");
    expect(screen.getByTestId("pathname")).toHaveTextContent(panePath("idle"));
  });

  it("does not claim unrelated chords, and empty lists are a no-op", () => {
    mount("blocked");
    expect(dispatch("ArrowDown", { ctrlKey: false, altKey: false }).defaultPrevented).toBe(false);
    expect(dispatch("ArrowLeft").defaultPrevented).toBe(false);
    expect(dispatch("ArrowDown", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(screen.getByTestId("pathname")).toHaveTextContent(/^\/$/);
    cleanup();

    mount(undefined, []);
    expect(dispatch("ArrowDown").defaultPrevented).toBe(false);
    expect(screen.getByTestId("pathname")).toHaveTextContent(/^\/$/);
  });

  it("removes its listener when unmounted", () => {
    const { unmount } = mount("blocked");
    unmount();
    expect(dispatch("ArrowDown").defaultPrevented).toBe(false);
  });
});
