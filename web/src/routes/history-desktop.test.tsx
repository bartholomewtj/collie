import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HistoryRoute } from "./history";
import { __resetDesktop, setDesktop } from "@/lib/desktop";
import type { HomeData, HistoryData } from "@/lib/loaders";

const entry = (uuid: string, text: string) => ({ uuid, ts: "2026-08-20T00:00:00.000Z", role: "user" as const, parts: [{ kind: "text" as const, text }] });
const home: HomeData = { bridge: "connected", device: undefined, agents: [{ paneId: "p1", workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t", agent: "claude", status: "idle", cwd: "/", focused: false, hasSession: true }], shellPanes: [], workspaces: [], tabs: [], sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false, authError: false };
const data: HistoryData = { paneId: "p1", session: undefined, entries: [entry("1", "turn one"), entry("2", "turn two")], hasMore: false, total: 2, fileTruncated: false };
beforeEach(() => { __resetDesktop(); setDesktop(true); Element.prototype.scrollTo = () => {}; }); afterEach(() => __resetDesktop());
it("keeps the History header outside its transcript scroller", async () => { const router = createMemoryRouter([{ id: "root", path: "/", loader: () => home, element: <Outlet />, children: [{ path: "pane/:paneId/history", loader: () => data, element: <HistoryRoute /> }] }], { initialEntries: ["/pane/p1/history"] }); const { container } = render(<RouterProvider router={router} />); await waitFor(() => expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1)); const scrollers = container.querySelectorAll(".overflow-y-auto"); expect(scrollers[0]).toContainElement(screen.getByText("turn one")); expect(scrollers[0]).not.toContainElement(container.querySelector("header")); });
