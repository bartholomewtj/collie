import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { __resetDesktop, setDesktop } from "@/lib/desktop";
import type { HomeData } from "@/lib/loaders";
import { RootLayout } from "./root";

vi.mock("@/hooks/use-polling", () => ({ usePolling: vi.fn() }));
vi.mock("@/hooks/use-transitions", () => ({ useAgentTransitions: vi.fn() }));
vi.mock("@/hooks/use-push", () => ({ usePushSetup: vi.fn() }));
vi.mock("@/hooks/use-poll-busy", () => ({ usePollBusy: vi.fn() }));
vi.mock("@/components/update-available-banner", () => ({ UpdateAvailableBanner: () => null }));
vi.mock("@/components/connection-banner", () => ({ ConnectionBanner: () => null }));

const data: HomeData = {
  bridge: "connected", device: undefined, agents: [], shellPanes: [], workspaces: [], tabs: [],
  sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false,
  authError: false, files: true,
};

beforeEach(() => __resetDesktop());
afterEach(() => __resetDesktop());

function renderRoot() {
  const router = createMemoryRouter([{
    id: "root", path: "/", loader: () => data, element: <RootLayout />, children: [
      { index: true, element: <div>Phone outlet</div> },
    ],
  }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

it("uses the phone outlet and BottomNav when desktop mode is off", async () => {
  renderRoot();
  await waitFor(() => expect(screen.getByText("Phone outlet")).toBeInTheDocument());
  expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  expect(screen.queryByText("Desktop mode is on")).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Desktop navigation" })).not.toBeInTheDocument();
});

it("uses DesktopShell and its sidebar when desktop mode is on", async () => {
  setDesktop(true);
  renderRoot();
  await waitFor(() => expect(screen.getByText(/Desktop mode is on/)).toBeInTheDocument());
  expect(screen.getByRole("navigation", { name: "Desktop navigation" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
});

it("turns off desktop mode from the shell", async () => {
  setDesktop(true);
  renderRoot();
  await waitFor(() => expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument());
  screen.getByRole("button", { name: "Turn off" }).click();
  await waitFor(() => expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument());
  expect(screen.queryByText(/Desktop mode is on/)).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Desktop navigation" })).not.toBeInTheDocument();
});
