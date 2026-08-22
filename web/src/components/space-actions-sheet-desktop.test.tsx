import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDesktop, __resetDesktop } from "@/lib/desktop";
import { SpaceActionsSheet } from "./space-actions-sheet";
import type { WorkspaceView } from "@/lib/types";
const workspace: WorkspaceView = { workspaceId: "w", number: 1, label: "one", focused: true, activeTabId: "t", tabCount: 1, paneCount: 1 };
const props = { open: true, onClose: vi.fn(), workspace, onRenamed: vi.fn() };
afterEach(() => { cleanup(); __resetDesktop(); });
describe("SpaceActionsSheet desktop", () => {
  it("renders rename in the anchored popover", () => { setDesktop(true); render(<SpaceActionsSheet {...props} anchor={{ x: 120, y: 200 }} />); const popover = screen.getByTestId("action-popover"); expect(popover).toHaveTextContent("Rename"); expect(popover).toHaveStyle({ left: "120px", top: "200px" }); expect(document.querySelector('button[aria-hidden="true"]')).toBeNull(); });
  it("uses the bottom sheet when desktop is off", () => { render(<SpaceActionsSheet {...props} />); expect(screen.queryByTestId("action-popover")).toBeNull(); expect(document.querySelector('button[aria-hidden="true"]')).not.toBeNull(); });
  it("keeps rename and Escape behaviour in the popover", () => { setDesktop(true); render(<SpaceActionsSheet {...props} workspace={{ ...workspace, label: "deploy" }} anchor={{ x: 1, y: 2 }} />); fireEvent.click(screen.getByRole("button", { name: "Rename" })); expect(screen.getByPlaceholderText("name this space")).toHaveValue("deploy"); fireEvent.keyDown(window, { key: "Escape" }); expect(props.onClose).toHaveBeenCalled(); });
});
