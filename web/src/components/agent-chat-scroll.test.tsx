import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentChat } from "./agent-chat";
import { __resetDesktop, setDesktop } from "@/lib/desktop";
import { fixtureAgents } from "@/test/handlers";

beforeEach(() => { __resetDesktop(); Element.prototype.scrollTo = () => {}; });
afterEach(() => __resetDesktop());
function show() { const agent = fixtureAgents[0]!; const router = createMemoryRouter([{ path: "/", element: <AgentChat paneId={agent.paneId} agent={agent} agents={[agent]} shellPanes={[]} text={Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n")} onBack={() => {}} onSelect={() => {}} /> }], { initialEntries: ["/"] }); return render(<RouterProvider router={router} />); }

describe("desktop pane scroll containment", () => {
  it("keeps pane chrome outside the mirror scroller", () => { setDesktop(true); const view = show(); const scrollers = view.container.querySelectorAll(".overflow-y-auto"); expect(scrollers).toHaveLength(1); expect(scrollers[0]).not.toContainElement(view.container.querySelector("header")); expect(scrollers[0]).not.toContainElement(screen.getByPlaceholderText(/type a reply/i)); expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument(); expect(view.container.firstElementChild).toHaveClass("overflow-hidden"); expect(view.container.querySelector("div.relative.shrink-0")).toBeInTheDocument(); });
  it("preserves the phone class list", () => { const view = show(); expect(view.container.firstElementChild).toHaveClass("max-w-[100dvw]", "overflow-x-hidden"); expect(view.container.firstElementChild).not.toHaveClass("overflow-hidden"); expect(view.container.querySelector("div.relative.shrink-0")).toBeNull(); });
});
