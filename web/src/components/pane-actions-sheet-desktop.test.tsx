import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDesktop, __resetDesktop } from "@/lib/desktop";
import { PaneActionsSheet } from "./pane-actions-sheet";
import type { AgentView } from "@/lib/types";

const pane: AgentView = { paneId: "w:p", workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "w:t", agent: "claude", status: "idle", cwd: "/tmp", focused: false };
const props = { open: true, onClose: vi.fn(), pane, onRenamed: vi.fn(), onClosed: vi.fn() };
afterEach(() => { cleanup(); __resetDesktop(); });
describe("PaneActionsSheet desktop", () => {
  it("uses the anchored popover on desktop and the sheet on phone", () => {
    setDesktop(true); render(<PaneActionsSheet {...props} anchor={{ x: 120, y: 200 }} />);
    expect(screen.getByTestId("action-popover")).toHaveStyle({ left: "120px", top: "200px" });
    expect(screen.getByTestId("action-popover")).toHaveTextContent("Close pane");
    expect(document.querySelector('button[aria-hidden="true"]')).toBeNull();
    cleanup(); __resetDesktop(); render(<PaneActionsSheet {...props} />);
    expect(screen.queryByTestId("action-popover")).toBeNull();
    expect(document.querySelector('button[aria-hidden="true"]')).not.toBeNull();
  });
  it("keeps rename and Escape behaviour in the popover", () => {
    setDesktop(true); render(<PaneActionsSheet {...props} anchor={{ x: 1, y: 2 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByPlaceholderText("name this pane")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });
});
