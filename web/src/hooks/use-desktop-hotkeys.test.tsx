import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { useDesktopHotkeys } from "./use-desktop-hotkeys";
import type { AgentView } from "@/lib/types";

const agent = (paneId: string, status: AgentView["status"]): AgentView => ({
  paneId, workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t",
  agent: "claude", status, cwd: "/tmp", focused: false,
});
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

describe("useDesktopHotkeys", () => {
  it("cycles triage agents and only owns its chords", () => {
    const navigate = vi.spyOn(window.history, "pushState");
    renderHook(() => useDesktopHotkeys({ agents: [agent("recent", "idle"), agent("need", "blocked"), agent("work", "working")], currentPaneId: "need" }), { wrapper });
    const down = new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const plain = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
    window.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    navigate.mockRestore();
  });

  it("wraps and handles an unknown pane", () => {
    const event = new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true, altKey: true, cancelable: true });
    renderHook(() => useDesktopHotkeys({ agents: [agent("one", "blocked"), agent("two", "working")], currentPaneId: "missing" }), { wrapper });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
