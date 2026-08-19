import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { clearStatus } from "@/lib/status";
import type { AgentView, TabView, WorkspaceView } from "@/lib/types";
import { SpaceView } from "./space-view";

beforeEach(() => clearStatus());

const workspace: WorkspaceView = {
  workspaceId: "w1",
  label: "workspace 1",
  number: 1,
  focused: true,
  activeTabId: "w1:t1",
  tabCount: 2,
  paneCount: 2,
};

const tabs: TabView[] = [
  { tabId: "w1:t1", workspaceId: "w1", number: 1, label: "code", focused: true, paneCount: 1 },
  { tabId: "w1:t2", workspaceId: "w1", number: 2, label: "notes", focused: false, paneCount: 1 },
  { tabId: "w2:t1", workspaceId: "w2", number: 1, label: "other", focused: false, paneCount: 1 },
];

const pane = (tabId: string, paneId: string): AgentView => ({
  paneId,
  workspaceId: "w1",
  workspaceLabel: "workspace 1",
  workspaceNumber: 1,
  tabId,
  agent: "claude",
  status: "idle",
  cwd: "/home/you/ws",
  focused: false,
});

const agents: AgentView[] = [
  pane("w1:t1", "w1:t1:p1"),
  pane("w1:t2", "w1:t2:p1"),
];

describe("SpaceView — rendering", () => {
  it("renders tab groups and panes in All view", () => {
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={agents}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("code")).toBeInTheDocument();
    expect(screen.getByText("notes")).toBeInTheDocument();
    expect(screen.queryByText("other")).toBeNull();
  });

  it("renders only selected tab panes and no tab headings when filtered", () => {
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={agents}
        shellPanes={[]}
        selectedTab="w1:t1"
        onOpen={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /actions$/ })).toBeNull();
    expect(screen.queryByText("code")).toBeNull();
    expect(screen.queryByText("notes")).toBeNull();
  });
});

describe("SpaceView — long-press tab actions", () => {
  it("opens the actions sheet on a long-press (contextmenu) when actions are wired", () => {
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={agents}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Tab code actions" }));
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close tab" })).toBeInTheDocument();
    expect(screen.getByText("Tab code")).toBeInTheDocument();
  });

  it("does not open the actions sheet on a plain tap of the heading button", async () => {
    const user = userEvent.setup();
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={agents}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Tab code actions" }));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("stays inert with no action props wired (no button, heading is text, contextmenu does nothing)", () => {
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={agents}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Tab code actions/ })).toBeNull();
    const heading = screen.getByText("code");
    expect(heading).toBeInTheDocument();
    expect(heading.tagName).toBe("H3");

    fireEvent.contextMenu(heading);
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("stays inert when only onRenamed is wired", () => {
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={agents}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
        onRenamed={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Tab code actions/ })).toBeNull();
    fireEvent.contextMenu(screen.getByText("code"));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("stays inert when only onClosed is wired", () => {
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={agents}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
        onClosed={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Tab code actions/ })).toBeNull();
    fireEvent.contextMenu(screen.getByText("code"));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("leaves the synthetic orphan group inert", () => {
    const orphanPane: AgentView = {
      ...pane("w1:unknown", "w1:unknown:p1"),
    };
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={[...agents, orphanPane]}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
      />,
    );

    expect(screen.getByText("…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tab … actions" })).toBeNull();
    fireEvent.contextMenu(screen.getByText("…"));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("opens the actions sheet via pointerdown timer hold", () => {
    vi.useFakeTimers();
    try {
      render(
        <SpaceView
          workspace={workspace}
          tabs={tabs}
          agents={agents}
          shellPanes={[]}
          selectedTab={null}
          onOpen={vi.fn()}
          onRenamed={vi.fn()}
          onClosed={vi.fn()}
        />,
      );

      expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
      fireEvent.pointerDown(screen.getByRole("button", { name: "Tab code actions" }), {
        button: 0,
        clientX: 10,
        clientY: 10,
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close tab" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a tab through the actions sheet and reports the closed tab id", async () => {
    const user = userEvent.setup();
    const onClosed = vi.fn();
    let url = "";
    server.use(
      http.post(/\/api\/tab\/[^/]+\/close$/, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );

    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={agents}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={onClosed}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Tab notes actions" }));
    await user.click(screen.getByRole("button", { name: "Close tab" }));
    await user.click(screen.getByRole("button", { name: "Tap again to close 1 pane" }));

    await waitFor(() => expect(onClosed).toHaveBeenCalledExactlyOnceWith("w1:t2"));
    expect(url).toContain("/api/tab/w1%3At2/close");
  });
});

const labelled: AgentView = { ...pane("w1:t1", "w1:t1:p1"), paneLabel: "alpha" };
const shell: AgentView = { ...pane("w1:t2", "w1:t2:s1"), kind: "shell", paneLabel: "shell one" };

describe("SpaceView — long-press pane actions", () => {
  it("opens the pane actions sheet on a long-press (contextmenu) when pane actions are wired", () => {
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={[labelled]}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
        onPaneClosed={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog", { name: "alpha" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();

    const row = screen.getByText("alpha").closest("button")!;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("dialog", { name: "alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close pane" })).toBeInTheDocument();
  });

  it("opens the pane actions sheet via pointerdown timer hold", () => {
    vi.useFakeTimers();
    try {
      render(
        <SpaceView
          workspace={workspace}
          tabs={tabs}
          agents={[labelled]}
          shellPanes={[]}
          selectedTab={null}
          onOpen={vi.fn()}
          onRenamed={vi.fn()}
          onClosed={vi.fn()}
          onPaneClosed={vi.fn()}
        />,
      );

      expect(screen.queryByRole("dialog", { name: "alpha" })).toBeNull();
      const row = screen.getByText("alpha").closest("button")!;
      fireEvent.pointerDown(row, {
        button: 0,
        clientX: 10,
        clientY: 10,
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.getByRole("dialog", { name: "alpha" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close pane" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the pane on a plain tap and does not open the actions sheet", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={[labelled]}
        shellPanes={[]}
        selectedTab={null}
        onOpen={onOpen}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
        onPaneClosed={vi.fn()}
      />,
    );

    const row = screen.getByText("alpha").closest("button")!;
    await user.click(row);

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("w1:t1:p1");
    expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "alpha" })).toBeNull();
  });

  it("stays inert without the required action props", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { unmount } = render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={[labelled]}
        shellPanes={[]}
        selectedTab={null}
        onOpen={onOpen}
      />,
    );

    const row1 = screen.getByText("alpha").closest("button")!;
    fireEvent.contextMenu(row1);
    expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();
    await user.click(row1);
    expect(onOpen).toHaveBeenCalledWith("w1:t1:p1");

    unmount();

    const onOpen2 = vi.fn();
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={[labelled]}
        shellPanes={[]}
        selectedTab={null}
        onOpen={onOpen2}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
      />,
    );

    const row2 = screen.getByText("alpha").closest("button")!;
    fireEvent.contextMenu(row2);
    expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();
    await user.click(row2);
    expect(onOpen2).toHaveBeenCalledWith("w1:t1:p1");
  });

  it("opens the pane actions sheet for a shell pane row", () => {
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={[]}
        shellPanes={[shell]}
        selectedTab={null}
        onOpen={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
        onPaneClosed={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog", { name: "shell one" })).toBeNull();
    const row = screen.getByText("shell one").closest("button")!;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("dialog", { name: "shell one" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close pane" })).toBeInTheDocument();
  });

  it("allows tab heading hold and pane row hold to work alongside without collision", () => {
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={[labelled]}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
        onPaneClosed={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Tab code actions" }));
    expect(screen.getByRole("dialog", { name: "Tab code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close tab" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();
  });
});

describe("SpaceView — tab traces mark", () => {
  const run = (adwId: string, status: string, startedAt: string) => ({
    repo: "myrepo",
    adwId,
    status,
    startedAt,
  });
  const withRuns: AgentView[] = [
    { ...pane("w1:t1", "w1:t1:p1"), sssf: { runs: [run("a1", "success", "2026-08-19T01:00:00Z")] } },
    { ...pane("w1:t1", "w1:t1:p2"), sssf: { runs: [run("a2", "running", "2026-08-19T02:00:00Z")] } },
    pane("w1:t2", "w1:t2:p1"),
  ];

  it("shows the lanes mark only on tabs whose panes launched runs, dotted while one is live", async () => {
    const onOpenTraces = vi.fn();
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={withRuns}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
        onOpenTraces={onOpenTraces}
      />,
    );
    const marks = screen.getAllByRole("button", { name: /ADW runs in this tab/ });
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveAccessibleName("ADW runs in this tab (one running)");
    await userEvent.click(marks[0]);
    // The tab's NEWEST run wins, with the pane that owns it.
    expect(onOpenTraces).toHaveBeenCalledWith("w1:t1:p2", expect.objectContaining({ adwId: "a2" }));
  });

  it("stays hidden when the route doesn't wire onOpenTraces", () => {
    render(
      <SpaceView
        workspace={workspace}
        tabs={tabs}
        agents={withRuns}
        shellPanes={[]}
        selectedTab={null}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /ADW runs in this tab/ })).toBeNull();
  });
});
