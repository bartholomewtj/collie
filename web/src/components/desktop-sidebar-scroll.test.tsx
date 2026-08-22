import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DesktopSidebar } from "./desktop-sidebar";
import { __resetDesktop } from "@/lib/desktop";
import type { HomeData } from "@/lib/loaders";

const data: HomeData = { bridge: "connected", device: undefined, agents: [], shellPanes: [], workspaces: [], tabs: [], sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false, authError: false, files: false };
beforeEach(() => __resetDesktop()); afterEach(() => __resetDesktop());
it("pins sidebar ends and leaves one tree scroll box", () => {
  const router = createMemoryRouter([{ path: "/", element: <DesktopSidebar data={data} /> }], { initialEntries: ["/"] });
  const { container } = render(<RouterProvider router={router} />);
  expect(container.querySelector("aside")).toHaveClass("min-h-0", "overflow-hidden");
  const scroll = container.querySelectorAll(".overflow-y-auto");
  expect(scroll).toHaveLength(1);
  expect(scroll[0]).toContainElement(screen.getAllByText("Spaces")[0]!);
  expect(screen.getByRole("navigation", { name: "Desktop navigation" })).toHaveClass("shrink-0");
});
