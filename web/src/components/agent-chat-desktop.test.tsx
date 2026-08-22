import { render, screen, cleanup } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { AgentChat } from "./agent-chat";
import { setDesktop, __resetDesktop } from "@/lib/desktop";
import { fixtureAgents } from "@/test/handlers";

beforeEach(() => { localStorage.clear(); Element.prototype.scrollTo = () => {}; });
afterEach(() => { cleanup(); __resetDesktop(); });
function show() { const a = fixtureAgents[0]!; const router = createMemoryRouter([{ path: "/", element: <AgentChat paneId={a.paneId} agent={a} agents={[a, fixtureAgents[1]!]} shellPanes={[]} text="output" onBack={() => {}} onSelect={() => {}} /> }]); render(<RouterProvider router={router} />); }
describe("AgentChat desktop controls", () => {
  it("keeps the phone controls off desktop", () => { show(); expect(screen.getByRole("button", { name: "Switch pane" })).toBeInTheDocument(); expect(screen.getByText("Keys")).toBeInTheDocument(); expect(screen.getByText("Type")).toBeInTheDocument(); });
  it("uses the desktop pane without phone controls", () => { setDesktop(true); show(); expect(screen.queryByRole("button", { name: "Switch pane" })).toBeNull(); expect(screen.queryByText("Keys")).toBeNull(); expect(screen.queryByText("Type")).toBeNull(); expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument(); });
});
