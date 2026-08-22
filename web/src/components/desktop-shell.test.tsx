import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { DesktopShell } from "./desktop-shell";
import { FilesRoute } from "@/routes/files";
import { __resetDesktop, desktopPrefs, setDesktop } from "@/lib/desktop";
import type { FilesData } from "@/lib/loaders";
import type { HomeData } from "@/lib/loaders";

const filesData: FilesData = { rel: "", data: { kind: "dir", path: "", entries: [], truncated: false } };

const data: HomeData = {
  bridge: "connected", device: undefined, agents: [], shellPanes: [], workspaces: [], tabs: [],
  sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false,
  authError: false, lastSeenAt: undefined, files: false,
};

beforeEach(() => { __resetDesktop(); setDesktop(true); });
afterEach(() => __resetDesktop());

it("renders the desktop off-ramp, outlet, and sidebar navigation", async () => {
  const router = createMemoryRouter([{ id: "root", path: "/", loader: () => data, element: <DesktopShell />, children: [{ index: true, element: <div>pane stand-in</div> }] }], { initialEntries: ["/"] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByText(/Desktop mode is on/)).toBeInTheDocument());
  expect(screen.getByText("pane stand-in")).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Desktop navigation" })).toBeInTheDocument();
  screen.getByRole("button", { name: "Turn off" }).click();
  expect(desktopPrefs().on).toBe(false);
  expect(localStorage.getItem("collie:desktop:v1")).toContain('"on":false');
});

it("keeps the phone files column capped but fills desktop width", async () => {
  __resetDesktop();
  const makeRouter = () => createMemoryRouter([{
    id: "root", path: "/", loader: () => ({ ...data, files: true }), element: <Outlet />,
    children: [{ path: "files", loader: () => filesData, element: <FilesRoute /> }],
  }], { initialEntries: ["/files"] });
  const phone = render(<RouterProvider router={makeRouter()} />);
  const phoneWrapper = (await screen.findByRole("searchbox")).closest(".mx-auto");
  expect(phoneWrapper).toHaveClass("max-w-screen-sm");
  phone.unmount();
  setDesktop(true);
  render(<RouterProvider router={makeRouter()} />);
  const desktopWrapper = (await screen.findByRole("searchbox")).closest(".mx-auto");
  expect(desktopWrapper).not.toHaveClass("max-w-screen-sm");
});
