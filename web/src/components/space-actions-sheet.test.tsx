import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { clearStatus } from "@/lib/status";
import type { WorkspaceView } from "@/lib/types";
import { SpaceActionsSheet } from "./space-actions-sheet";

// The long-press space actions sheet — the tab actions sheet minus the destructive row: an
// action-list first view (Rename), with rename tucked behind its own tap so opening the sheet never
// shoves a keyboard-triggering input at you. Like a tab, a blank space label can't be saved (herdr
// has no "clear" for a workspace). Wired to the bridge via lib/api (exercised through MSW); the
// parent gets the onRenamed side-effect callback.

beforeEach(() => clearStatus());

const workspace: WorkspaceView = {
  workspaceId: "w1",
  number: 1,
  label: "collie",
  focused: true,
  activeTabId: "w1:t1",
  tabCount: 1,
  paneCount: 2,
};

function renderSheet(overrides: Partial<React.ComponentProps<typeof SpaceActionsSheet>> = {}) {
  const props: React.ComponentProps<typeof SpaceActionsSheet> = {
    open: true,
    onClose: vi.fn(),
    workspace,
    onRenamed: vi.fn(),
    ...overrides,
  };
  render(<SpaceActionsSheet {...props} />);
  return props;
}

describe("SpaceActionsSheet — action list", () => {
  it("opens on the action list, not the rename input, and has no close row", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close space|close tab/i })).toBeNull();
    expect(screen.queryByPlaceholderText("name this space")).toBeNull();
  });
});

describe("SpaceActionsSheet — rename", () => {
  it("stays on the action list until Rename is tapped, then shows the prefilled input", async () => {
    const user = userEvent.setup();
    renderSheet({ workspace: { ...workspace, label: "deploy" } });
    expect(screen.queryByPlaceholderText("name this space")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByPlaceholderText("name this space")).toHaveValue("deploy");
  });

  it("autofocuses the input once rename mode opens", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(screen.getByPlaceholderText("name this space")).toHaveFocus());
  });

  it("Back returns to the action list without saving", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.queryByPlaceholderText("name this space")).toBeNull();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
  });

  it("posts the trimmed label, then calls onRenamed and closes", async () => {
    const user = userEvent.setup();
    let body: unknown;
    let url = "";
    server.use(
      http.post(/\/api\/workspace\/[^/]+\/rename$/, async ({ request }) => {
        url = request.url;
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const props = renderSheet();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByPlaceholderText("name this space");
    await user.clear(input);
    await user.type(input, "  api  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(props.onRenamed).toHaveBeenCalledTimes(1));
    expect(body).toEqual({ label: "api" });
    expect(url).toContain("/api/workspace/w1/rename");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("disables Save on a blank field — a space has no clear", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    await user.clear(screen.getByPlaceholderText("name this space"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("does NOT revalidate or close when the rename fails (error goes to the status channel)", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(/\/api\/workspace\/[^/]+\/rename$/, () =>
        HttpResponse.json({ ok: false, error: "workspace not found" }),
      ),
    );
    const props = renderSheet();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByPlaceholderText("name this space");
    await user.clear(input);
    await user.type(input, "x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
    expect(props.onRenamed).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("resets back to the action list when the sheet reopens, even mid-rename", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SpaceActionsSheet open={true} onClose={vi.fn()} workspace={workspace} onRenamed={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByPlaceholderText("name this space")).toBeInTheDocument();

    rerender(
      <SpaceActionsSheet open={false} onClose={vi.fn()} workspace={workspace} onRenamed={vi.fn()} />,
    );
    rerender(
      <SpaceActionsSheet open={true} onClose={vi.fn()} workspace={workspace} onRenamed={vi.fn()} />,
    );

    expect(screen.queryByPlaceholderText("name this space")).toBeNull();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
  });

  it("resets back to the action list when the target workspace changes, even mid-rename", async () => {
    const user = userEvent.setup();
    const other: WorkspaceView = { ...workspace, workspaceId: "w2", label: "other" };
    const { rerender } = render(
      <SpaceActionsSheet open={true} onClose={vi.fn()} workspace={workspace} onRenamed={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByPlaceholderText("name this space")).toBeInTheDocument();

    rerender(
      <SpaceActionsSheet open={true} onClose={vi.fn()} workspace={other} onRenamed={vi.fn()} />,
    );

    expect(screen.queryByPlaceholderText("name this space")).toBeNull();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
  });

  // The label is user text; it must render only as an <input> value / text node, never markup — same
  // XSS boundary as pane labels and pane output.
  it("renders a markup-looking label as literal text, injecting nothing", async () => {
    const user = userEvent.setup();
    const xss = "<img src=x onerror=alert(1)>";
    renderSheet({ workspace: { ...workspace, label: xss } });
    expect(document.querySelector("img")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByPlaceholderText("name this space")).toHaveValue(xss);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("SpaceActionsSheet — read-only", () => {
  it("shows a note and no write actions when the device isn't authorised", () => {
    renderSheet({ readOnly: true });
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByPlaceholderText("name this space")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
