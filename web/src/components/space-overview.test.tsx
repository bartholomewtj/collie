import { MemoryRouter, useLocation } from "react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SpaceOverview } from "./space-overview";
import type { AgentView, WorkspaceView } from "@/lib/types";

function ws(
  workspaceId: string,
  label: string,
  tabCount: number,
  paneCount: number,
  sssf?: WorkspaceView["sssf"],
): WorkspaceView {
  return {
    workspaceId,
    number: 1,
    label,
    focused: false,
    activeTabId: `${workspaceId}:t1`,
    tabCount,
    paneCount,
    sssf,
  };
}

function sssf(
  repos: Array<{ name: string; running?: boolean }>,
  attachedRepo?: string,
): NonNullable<WorkspaceView["sssf"]> {
  return {
    state: "ready",
    token: "tok",
    repos: repos.map((r) => ({ name: r.name, state: "ready", running: !!r.running })),
    attached: attachedRepo ? { repo: attachedRepo } : undefined,
  };
}

function pane(over: Partial<AgentView> & { paneId: string; workspaceId: string }): AgentView {
  return {
    workspaceLabel: "ws",
    workspaceNumber: 1,
    tabId: `${over.workspaceId}:t1`,
    agent: "claude",
    status: "idle",
    cwd: "/home/you/demo",
    focused: false,
    ...over,
  };
}

/** Renders the current URL so a navigation is assertable without a data router. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>;
}

/** The section is foldable now, so every test declares the state it wants to exercise. */
function view(props: Partial<Parameters<typeof SpaceOverview>[0]> = {}) {
  return (
    <MemoryRouter initialEntries={["/spaces"]}>
      <SpaceOverview
        workspaces={[]}
        agents={[]}
        onOpen={vi.fn()}
        onNewSpace={vi.fn()}
        open
        onOpenChange={vi.fn()}
        {...props}
      />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe("SpaceOverview", () => {
  it("shows an empty state when there are no spaces", () => {
    render(view());
    expect(screen.getByText(/no spaces yet/i)).toBeInTheDocument();
  });

  it("renders each space with its pane count (pluralized)", () => {
    render(view({ workspaces: [ws("w1", "anchorgenius", 2, 3), ws("w2", "tgl", 1, 1)] }));
    expect(screen.getByText("anchorgenius")).toBeInTheDocument();
    expect(screen.getByLabelText("3 panes")).toBeInTheDocument();
    expect(screen.getByLabelText("1 pane")).toBeInTheDocument(); // singular
  });

  it("opens a space when its card is tapped", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(view({ workspaces: [ws("w1", "anchorgenius", 2, 3)], onOpen }));
    await user.click(screen.getByRole("button", { name: /anchorgenius/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("w1");
  });

  it("creates a new space from the header button", async () => {
    const user = userEvent.setup();
    const onNewSpace = vi.fn();
    render(view({ onNewSpace }));
    await user.click(screen.getByRole("button", { name: /new space/i }));
    expect(onNewSpace).toHaveBeenCalledOnce();
  });
});

describe("SpaceOverview — folding", () => {
  const spaces = [ws("w1", "anchorgenius", 2, 3), ws("w2", "tgl", 1, 1)];

  it("hides the list when folded, keeping the count on the header", () => {
    render(view({ workspaces: spaces, open: false }));
    expect(screen.queryByText("anchorgenius")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /spaces/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("keeps the new-space button reachable while folded", async () => {
    const user = userEvent.setup();
    const onNewSpace = vi.fn();
    render(view({ workspaces: spaces, open: false, onNewSpace }));
    await user.click(screen.getByRole("button", { name: /new space/i }));
    expect(onNewSpace).toHaveBeenCalledOnce();
  });

  it("reports the fold to its owner rather than keeping the state itself", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(view({ workspaces: spaces, open: true, onOpenChange }));
    await user.click(screen.getByRole("button", { name: /spaces/i }));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("shows a blocked count on the header, so you know why to expand", () => {
    render(
      view({
        workspaces: spaces,
        open: false,
        agents: [pane({ paneId: "w1:p1", workspaceId: "w1", status: "blocked" })],
      }),
    );
    expect(screen.getByLabelText("1 space needs you")).toBeInTheDocument();
  });
});

describe("SpaceOverview — filtering", () => {
  const spaces = [ws("w1", "moonward_os", 1, 1), ws("w2", "trader", 1, 1), ws("w3", "moon_probe", 1, 1)];

  it("narrows the list as you type, case-insensitively", async () => {
    const user = userEvent.setup();
    render(view({ workspaces: spaces }));
    await user.type(screen.getByLabelText(/filter spaces/i), "MOON");
    expect(screen.getByText("moonward_os")).toBeInTheDocument();
    expect(screen.getByText("moon_probe")).toBeInTheDocument();
    expect(screen.queryByText("trader")).not.toBeInTheDocument();
  });

  it("says so when nothing matches, instead of showing a bare empty area", async () => {
    const user = userEvent.setup();
    render(view({ workspaces: spaces }));
    await user.type(screen.getByLabelText(/filter spaces/i), "zzz");
    expect(screen.getByText(/no space matches/i)).toBeInTheDocument();
  });

  it("offers no filter box for a single space — there is nothing to filter", () => {
    render(view({ workspaces: [ws("w1", "solo", 1, 1)] }));
    expect(screen.queryByLabelText(/filter spaces/i)).not.toBeInTheDocument();
  });
});

describe("SpaceOverview — recency", () => {
  it("puts the space you used most recently first, whatever Herdr's order", () => {
    const spaces = [ws("w1", "alpha", 1, 1), ws("w2", "beta", 1, 1)];
    render(
      view({
        workspaces: spaces,
        agents: [
          pane({ paneId: "w1:p1", workspaceId: "w1", lastSeenAt: 100 }),
          pane({ paneId: "w2:p1", workspaceId: "w2", lastSeenAt: 900 }),
        ],
      }),
    );
    const labels = screen.getAllByRole("button", { name: /alpha|beta/ }).map((b) => b.textContent);
    expect(labels[0]).toContain("beta");
    expect(labels[1]).toContain("alpha");
  });

  it("counts a bare shell as having used the space", () => {
    const spaces = [ws("w1", "alpha", 1, 1), ws("w2", "beta", 1, 1)];
    render(
      view({
        workspaces: spaces,
        agents: [pane({ paneId: "w1:p1", workspaceId: "w1", lastSeenAt: 100 })],
        shellPanes: [pane({ paneId: "w2:p1", workspaceId: "w2", kind: "shell", lastSeenAt: 900 })],
      }),
    );
    const labels = screen.getAllByRole("button", { name: /alpha|beta/ }).map((b) => b.textContent);
    expect(labels[0]).toContain("beta");
  });

  it("shows no timestamp for a space on a bridge that reports none", () => {
    render(view({ workspaces: [ws("w1", "alpha", 1, 1)] }));
    expect(screen.queryByText(/ago|just now/i)).not.toBeInTheDocument();
  });
});

describe("SpaceOverview — traces mark", () => {
  it("shows the lanes mark for a space with SSSF repos", () => {
    render(view({ workspaces: [ws("w1", "collie", 1, 1, sssf([{ name: "collie" }]))] }));
    expect(screen.getByRole("button", { name: "ADW runs in this space" })).toBeInTheDocument();
  });

  it("renders no mark for a space with no traces or empty repos", () => {
    render(view({ workspaces: [ws("w1", "plain", 1, 1)] }));
    expect(screen.queryByRole("button", { name: /ADW runs in this space/ })).not.toBeInTheDocument();

    render(view({ workspaces: [ws("w2", "empty-repos", 1, 1, sssf([]))] }));
    expect(screen.queryByRole("button", { name: /ADW runs in this space/ })).not.toBeInTheDocument();
  });

  it("renders a live dot and updates the label when a run is live", () => {
    render(
      view({
        workspaces: [
          ws("w1", "collie", 1, 1, sssf([{ name: "a" }, { name: "b", running: true }])),
        ],
      }),
    );
    const btn = screen.getByRole("button", { name: "ADW runs in this space (one running)" });
    expect(btn).toBeInTheDocument();
    expect(btn.querySelector(".bg-emerald-400")).not.toBeNull();
  });

  it("does not render the green dot when no runs are live", () => {
    render(
      view({
        workspaces: [
          ws("w1", "collie", 1, 1, sssf([{ name: "a", running: false }])),
        ],
      }),
    );
    const btn = screen.getByRole("button", { name: "ADW runs in this space" });
    expect(btn).toBeInTheDocument();
    expect(btn.querySelector(".bg-emerald-400")).toBeNull();
  });

  it("navigates to traces and does not call onOpen when tapping the mark", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      view({
        workspaces: [ws("w1", "collie", 1, 1, sssf([{ name: "collie" }]))],
        onOpen,
      }),
    );
    await user.click(screen.getByRole("button", { name: "ADW runs in this space" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/traces/w1/collie");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("includes the session in the traces path when provided", async () => {
    const user = userEvent.setup();
    render(
      view({
        workspaces: [ws("w1", "collie", 1, 1, sssf([{ name: "collie" }]))],
        session: "demo",
      }),
    );
    await user.click(screen.getByRole("button", { name: "ADW runs in this space" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/traces/w1/collie?s=demo");
  });

  it("opens the attached repo when the bridge named one", async () => {
    const user = userEvent.setup();
    render(
      view({
        workspaces: [
          ws("w1", "collie", 1, 1, sssf([{ name: "first" }, { name: "second" }], "second")),
        ],
      }),
    );
    await user.click(screen.getByRole("button", { name: "ADW runs in this space" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/traces/w1/second");
  });

  it("still calls onOpen when tapping the space row", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      view({
        workspaces: [ws("w1", "collie", 1, 1, sssf([{ name: "collie" }]))],
        onOpen,
      }),
    );
    await user.click(screen.getByRole("button", { name: /collie/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("w1");
  });
});

describe("SpaceOverview — long-press rename", () => {
  it("opens the space actions sheet on a long-press when onRenamed is wired", () => {
    render(
      view({
        workspaces: [ws("w1", "anchorgenius", 2, 3)],
        onRenamed: vi.fn(),
      }),
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /anchorgenius/ }));
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("Space anchorgenius");
  });

  it("stays inert on contextmenu when onRenamed is not wired", () => {
    render(
      view({
        workspaces: [ws("w1", "anchorgenius", 2, 3)],
      }),
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /anchorgenius/ }));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("still opens the space on a plain tap, without opening the sheet", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      view({
        workspaces: [ws("w1", "anchorgenius", 2, 3)],
        onOpen,
        onRenamed: vi.fn(),
      }),
    );
    await user.click(screen.getByRole("button", { name: /anchorgenius/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("w1");
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });
});
