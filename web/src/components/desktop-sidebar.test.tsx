import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { DesktopSidebar } from "./desktop-sidebar";
import { __resetDesktop } from "@/lib/desktop";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { homePath } from "@/lib/nav";

const data: HomeData = {
  bridge: "connected", device: undefined, agents: [], shellPanes: [], workspaces: [], tabs: [],
  sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false,
  authError: false, files: true,
};

beforeEach(() => __resetDesktop());
afterEach(() => __resetDesktop());

function renderSidebar(workspaces = data.workspaces, files = true) {
  const router = createMemoryRouter([{ id: "root", path: "/", loader: () => ({ ...data, workspaces, files }), element: <DesktopSidebar data={{ ...data, workspaces, files }} /> }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

it("shows Files only when files are available and Traces only when a workspace has traces", async () => {
  const { rerender } = renderSidebar();
  await waitFor(() => expect(screen.getByText("Files")).toBeInTheDocument());
  expect(screen.queryByText("Traces")).not.toBeInTheDocument();
  const traced: HomeData["workspaces"][number] = { workspaceId: "w1", number: 1, label: "one", focused: false, activeTabId: "w1:t1", tabCount: 0, paneCount: 0, sssf: { state: "ready", token: "t", repos: [] } };
  rerender(<RouterProvider router={createMemoryRouter([{ id: "root", path: "/", element: <DesktopSidebar data={{ ...data, files: false, workspaces: [traced] }} />}], { initialEntries: ["/"] })} />);
  expect(screen.queryByText("Files")).not.toBeInTheDocument();
  expect(screen.getByText("Traces")).toBeInTheDocument();
});

it("opens the new-space dialog and creates a space with the real action", async () => {
  const router = createMemoryRouter([{
    id: ROOT_ROUTE_ID, path: "/", loader: () => data,
    element: <><DesktopSidebar data={data} /><Outlet /></>,
    children: [{ path: "pane/:paneId", element: <div>new pane</div> }],
  }], { initialEntries: [homePath(data.session)] });
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByLabelText("New space"));
  expect(await screen.findByText("Directory (optional)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Create space/ }));
  await waitFor(() => expect(decodeURIComponent(router.state.location.pathname)).toBe("/pane/w9:p1"));
});
