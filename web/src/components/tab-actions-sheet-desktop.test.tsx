import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDesktop, __resetDesktop } from "@/lib/desktop";
import { TabActionsSheet } from "./tab-actions-sheet";
import type { TabView } from "@/lib/types";
const tab: TabView = { tabId: "w:t", workspaceId: "w", number: 1, label: "one", focused: true, paneCount: 1 };
const props = { open: true, onClose: vi.fn(), tab, onRenamed: vi.fn(), onClosed: vi.fn() };
afterEach(() => { cleanup(); __resetDesktop(); });
describe("TabActionsSheet desktop", () => {
  it("renders the same rows in the anchored popover", () => { setDesktop(true); render(<TabActionsSheet {...props} anchor={{ x: 120, y: 200 }} />); const popover = screen.getByTestId("action-popover"); expect(popover).toHaveTextContent("Rename"); expect(popover).toHaveTextContent("Close tab"); expect(popover).toHaveStyle({ left: "120px", top: "200px" }); expect(document.querySelector('button[aria-hidden="true"]')).toBeNull(); });
  it("uses the bottom sheet when desktop is off", () => { render(<TabActionsSheet {...props} />); expect(screen.queryByTestId("action-popover")).toBeNull(); expect(document.querySelector('button[aria-hidden="true"]')).not.toBeNull(); });
  it("keeps rename and Escape behaviour in the popover", () => { setDesktop(true); render(<TabActionsSheet {...props} tab={{ ...tab, label: "deploy" }} anchor={{ x: 1, y: 2 }} />); fireEvent.click(screen.getByRole("button", { name: "Rename" })); expect(screen.getByPlaceholderText("name this tab")).toHaveValue("deploy"); fireEvent.keyDown(window, { key: "Escape" }); expect(props.onClose).toHaveBeenCalled(); });
});
