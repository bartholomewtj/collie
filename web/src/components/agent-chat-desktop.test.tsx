import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentChat } from "./agent-chat";
import { setDesktop, __resetDesktop } from "@/lib/desktop";
import { fixtureAgents } from "@/test/handlers";

beforeEach(() => { localStorage.clear(); Element.prototype.scrollTo = () => {}; __resetDesktop(); });
afterEach(() => { cleanup(); __resetDesktop(); });
function show() {
  const a = fixtureAgents[0]!;
  const sibling = { ...a, paneId: "w1:p2" };
  const router = createMemoryRouter([{ path: "/", element: <AgentChat paneId={a.paneId} agent={a} agents={[a, sibling]} shellPanes={[]} text="output" onBack={() => {}} onSelect={() => {}} /> }]);
  render(<RouterProvider router={router} />);
}
describe("AgentChat desktop controls", () => {
  it("shows phone controls and opens the pane switcher", () => {
    show();
    expect(screen.getByRole("button", { name: "Switch pane" })).toBeInTheDocument();
    expect(screen.getByText("Panes")).toBeInTheDocument();
    expect(screen.getByText("Keys")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Type into terminal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach image" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch pane" }));
    expect(screen.getByRole("dialog", { name: "Switch pane" })).toBeInTheDocument();
  });

  it("hides phone controls while keeping the composer on desktop", () => {
    setDesktop(true);
    show();
    expect(screen.queryByRole("button", { name: "Switch pane" })).toBeNull();
    expect(screen.queryByText("Panes")).toBeNull();
    expect(screen.queryByText("Keys")).toBeNull();
    expect(screen.queryByRole("button", { name: "Type into terminal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Attach image" })).toBeNull();
    expect(screen.getByPlaceholderText(/type a reply/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });
});
