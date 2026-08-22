import { render, cleanup, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RootLayout } from "./root";
import { ROOT_ROUTE_ID } from "@/lib/loaders";
import { setDesktop, __resetDesktop } from "@/lib/desktop";
import type { HomeData } from "@/lib/loaders";

vi.mock("@/hooks/use-polling", () => ({ usePolling: vi.fn() }));
vi.mock("@/hooks/use-transitions", () => ({ useAgentTransitions: vi.fn() }));
vi.mock("@/hooks/use-push", () => ({ usePushSetup: vi.fn() }));
vi.mock("@/hooks/use-poll-busy", () => ({ usePollBusy: vi.fn() }));
vi.mock("@/components/update-available-banner", () => ({ UpdateAvailableBanner: () => null }));
vi.mock("@/components/connection-banner", () => ({ ConnectionBanner: () => null }));
function data(agents: HomeData["agents"] = []) { return { bridge: "connected", device: undefined, agents, shellPanes: [], workspaces: [], tabs: [], sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false, authError: false, files: false } as HomeData; }
function agent(paneId: string) { return { paneId, workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t", agent: "claude", status: "blocked" as const, cwd: "/tmp", focused: false }; }
function show(home = data()) { const router = createMemoryRouter([{ id: ROOT_ROUTE_ID, path: "/", loader: () => home, element: <RootLayout />, children: [{ index: true, element: <div /> }] }]); return render(<RouterProvider router={router} />); }
afterEach(() => { cleanup(); __resetDesktop(); });
describe("desktop document title", () => {
  it("leaves title alone when off", async () => { document.title = "Existing"; show(); await waitFor(() => expect(document.title).toBe("Existing")); });
  it("counts needs agents when on", async () => { setDesktop(true); show(data([agent("a"), agent("b")])); await waitFor(() => expect(document.title).toBe("(2) Collie")); });
  it("uses the plain title on desktop with no needs agents", async () => { setDesktop(true); document.title = "Existing"; show(data([])); await waitFor(() => expect(document.title).toBe("Collie")); });
});
