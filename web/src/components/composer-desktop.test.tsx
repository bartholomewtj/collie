import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Composer } from "./composer";
import { __resetDesktop, setDesktop } from "@/lib/desktop";
import { server } from "@/test/setup";
import { recordReply } from "@/test/handlers";
import { clearStatus, useStatus } from "@/lib/status";

function StatusSentinel() { const status = useStatus(); return <output data-testid="status">{status?.text ?? ""}</output>; }

function mount(overrides: Partial<React.ComponentProps<typeof Composer>> = {}, withStatus = false) {
  const props: React.ComponentProps<typeof Composer> = {
    paneId: "w1:p1", agent: "claude", isShell: false, gone: false, readOnly: false,
    dialogPresent: false, text: "output", terminalDraft: null, rawTerminalDraft: null,
    prefs: { fontSize: 11, rawTerminal: false, tapToFocus: true }, stepFontSize: () => {},
    setRawTerminal: () => {}, setTapToFocus: () => {}, onSent: () => {}, ...overrides,
  };
  const router = createMemoryRouter([{ path: "/", element: withStatus ? <><StatusSentinel /><Composer {...props} /></> : <Composer {...props} /> }]);
  render(<RouterProvider router={router} />);
  return screen.getByPlaceholderText(/type a reply/i);
}

beforeEach(() => { localStorage.clear(); __resetDesktop(); clearStatus(); });
afterEach(() => { cleanup(); __resetDesktop(); });

describe("desktop composer behavior", () => {
  it("keeps phone Enter as a newline and does not prevent it", () => {
    const box = mount();
    fireEvent.change(box, { target: { value: "hello" } });
    const event = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    box.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(box).toHaveValue("hello");
  });

  it("keeps phone draft refusal and its status", () => {
    const box = mount({}, true);
    fireEvent.change(box, { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Type into terminal" }));
    expect(screen.getByTestId("status")).toHaveTextContent("Send or clear the draft before typing into the terminal.");
  });

  it("sends desktop Enter and uses Shift+Enter for a newline", async () => {
    setDesktop(true);
    server.use(http.post(/\/api\/pane\/[^/]+\/reply$/, async ({ request }) => {
      const body = (await request.json()) as { text: string; submit?: boolean };
      recordReply(body);
      return HttpResponse.json({ ok: true });
    }));
    const box = mount();
    await userEvent.setup().type(box, "hello");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(box).toHaveValue(""));
    fireEvent.change(box, { target: { value: "\n" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(box).toHaveValue("\n");
  });

  it("keeps Ctrl+Enter sending and ignores composing Enter", async () => {
    setDesktop(true);
    server.use(http.post(/\/api\/pane\/[^/]+\/reply$/, async ({ request }) => {
      const body = (await request.json()) as { text: string; submit?: boolean };
      recordReply(body); return HttpResponse.json({ ok: true });
    }));
    const box = mount();
    const composing = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    Object.defineProperty(composing, "isComposing", { value: true });
    box.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    fireEvent.change(box, { target: { value: "ctrl" } });
    box.focus();
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(box).toHaveValue("ctrl");
  });

  it("passes empty navigation keys through and never Ctrl+C", async () => {
    setDesktop(true);
    const keys: string[][] = [];
    server.use(http.post(/\/api\/pane\/[^/]+\/keys$/, async ({ request }) => {
      keys.push(((await request.json()) as { keys: string[] }).keys); return HttpResponse.json({ ok: true });
    }));
    const box = mount();
    for (const [key, expected] of [["Escape", "Escape"], ["Tab", "Tab"], ["ArrowUp", "Up"], ["ArrowDown", "Down"], ["ArrowLeft", "Left"], ["ArrowRight", "Right"]]) {
      fireEvent.keyDown(box, { key });
      await waitFor(() => expect(keys).toContainEqual([expected]));
    }
    const copy = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, cancelable: true });
    box.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(false);
    expect(keys).toHaveLength(6);
  });

  it("does not pass editing keys through when non-empty", () => {
    setDesktop(true); const box = mount(); fireEvent.change(box, { target: { value: "text" } });
    fireEvent.keyDown(box, { key: "Escape" }); fireEvent.keyDown(box, { key: "ArrowUp" });
  });

  it("keeps destructive sends behind the two-tap confirm", async () => {
    setDesktop(true); const box = mount({}, true); const user = userEvent.setup();
    await user.type(box, "rm -rf /tmp/x");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByTestId("status")).toHaveTextContent(/Destructive: .*tap Send again/);
  });

  it("does not send or prevent an IME Enter", () => {
    setDesktop(true);
    const box = mount();
    const event = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    Object.defineProperty(event, "isComposing", { value: true });
    box.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
