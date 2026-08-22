import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopShell } from "./desktop-shell";
import { RootLayout } from "@/routes/root";
import { __resetDesktop, setDesktop } from "@/lib/desktop";

vi.mock("@/hooks/use-polling", () => ({ usePolling: vi.fn() }));
vi.mock("@/hooks/use-transitions", () => ({ useAgentTransitions: vi.fn() }));
vi.mock("@/hooks/use-push", () => ({ usePushSetup: vi.fn() }));
vi.mock("@/hooks/use-poll-busy", () => ({ usePollBusy: vi.fn() }));
vi.mock("@/components/update-available-banner", () => ({ UpdateAvailableBanner: () => null }));
vi.mock("@/components/connection-banner", () => ({ ConnectionBanner: () => null }));

const data = { bridge: "connected" as const, device: undefined, agents: [], shellPanes: [], workspaces: [], tabs: [], sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false, authError: false, files: false };
function renderShell() { const router = createMemoryRouter([{ id: "root", path: "/", loader: () => data, element: <DesktopShell />, children: [{ index: true, element: <div>pane stand-in</div> }] }], { initialEntries: ["/"] }); return render(<RouterProvider router={router} />); }

beforeEach(() => { __resetDesktop(); setDesktop(true); });
afterEach(() => { __resetDesktop(); });

describe("desktop shell scroll containment", () => {
  it("adds the document frame class and bounds its grid and outlet", () => {
    const view = renderShell();
    return waitFor(() => expect(document.documentElement).toHaveClass("collie-desktop")).then(() => {
    const grid = screen.getByText(/Desktop mode is on/).closest("div.grid")!;
    expect(grid).toHaveClass("grid-rows-[auto_minmax(0,1fr)]", "overflow-hidden");
    expect(screen.getByText("pane stand-in").parentElement).toHaveClass("flex", "flex-col", "min-h-0");
    view.unmount();
    expect(document.documentElement).not.toHaveClass("collie-desktop");
    });
  });

  it("leaves the document frame class off on the phone layout", async () => {
    __resetDesktop();
    const router = createMemoryRouter([{ id: "root", path: "/", loader: () => data, element: <RootLayout />, children: [{ index: true, element: <div>Phone outlet</div> }] }], { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByText("Phone outlet")).toBeInTheDocument());
    expect(document.documentElement).not.toHaveClass("collie-desktop");
  });
});
