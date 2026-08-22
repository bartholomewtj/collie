import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootLayout } from "./root";
import { __resetDesktop, setDesktop } from "@/lib/desktop";

vi.mock("@/hooks/use-polling", () => ({ usePolling: vi.fn() }));
vi.mock("@/hooks/use-transitions", () => ({ useAgentTransitions: vi.fn() }));
vi.mock("@/hooks/use-push", () => ({ usePushSetup: vi.fn() }));
vi.mock("@/hooks/use-poll-busy", () => ({ usePollBusy: vi.fn() }));
vi.mock("@/components/update-available-banner", () => ({ UpdateAvailableBanner: () => null }));
vi.mock("@/components/connection-banner", () => ({ ConnectionBanner: () => null }));
const data = { bridge: "connected" as const, device: undefined, agents: [], shellPanes: [], workspaces: [], tabs: [], sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false, authError: false, files: false };
beforeEach(() => __resetDesktop()); afterEach(() => __resetDesktop());
function show() { const router = createMemoryRouter([{ id: "root", path: "/", loader: () => data, element: <RootLayout />, children: [{ index: true, element: <div>outlet</div> }] }], { initialEntries: ["/"] }); return render(<RouterProvider router={router} />); }
describe("root desktop frame", () => {
  it("keeps the phone root class unchanged", async () => { const view = show(); await screen.findByText("outlet"); expect(view.container.firstElementChild).toHaveClass("flex", "h-[100dvh]", "flex-col"); expect(view.container.firstElementChild).not.toHaveClass("overflow-hidden"); });
  it("clips the desktop root", async () => { setDesktop(true); const view = show(); await screen.findByText(/Desktop mode is on/); expect(view.container.firstElementChild).toHaveClass("overflow-hidden"); });
});
