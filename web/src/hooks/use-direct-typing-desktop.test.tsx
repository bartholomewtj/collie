import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useDirectTyping } from "./use-direct-typing";
import { setLocked } from "@/lib/idle";
import { clearStatus, useStatus } from "@/lib/status";

function StatusSentinel() { const status = useStatus(); return <output data-testid="status">{status?.text ?? ""}</output>; }

function Probe({ desktop, draft = "", onDraftRead }: { desktop: boolean; draft?: string; onDraftRead?: () => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const lockedDraft = false;
  const direct = useDirectTyping({ paneKey: "p", inputRef: input, replyDraft: () => { onDraftRead?.(); return draft; }, canActivate: () => !lockedDraft, suspended: lockedDraft, sendKeys: vi.fn(async () => true), onActivate: vi.fn(), focusInput: () => input.current?.focus(), desktop });
  return <><textarea ref={input} onBlur={direct.onBlur} data-testid="input" /><button onClick={direct.activate}>arm</button><output data-testid="active">{String(direct.active)}</output></>;
}

beforeEach(() => { localStorage.clear(); clearStatus(); setLocked(false); });
afterEach(() => { cleanup(); setLocked(false); });

describe("useDirectTyping desktop", () => {
  it("keeps phone draft refusal and status", () => { render(<><StatusSentinel /><Probe desktop={false} draft="draft" /></>); fireEvent.click(screen.getByText("arm")); expect(screen.getByTestId("active")).toHaveTextContent("false"); expect(screen.getByTestId("status")).toHaveTextContent("Send or clear the draft before typing into the terminal."); });
  it("bypasses draft refusal on desktop without mutating the draft", () => { const read = vi.fn(); render(<Probe desktop draft="draft" onDraftRead={read} />); fireEvent.click(screen.getByText("arm")); expect(screen.getByTestId("active")).toHaveTextContent("true"); expect(read).not.toHaveBeenCalled(); });
  it("releases on desktop blur but not phone blur", () => { const { rerender } = render(<Probe desktop />); fireEvent.click(screen.getByText("arm")); fireEvent.blur(screen.getByTestId("input")); expect(screen.getByTestId("active")).toHaveTextContent("false"); rerender(<Probe desktop={false} />); fireEvent.click(screen.getByText("arm")); fireEvent.blur(screen.getByTestId("input")); expect(screen.getByTestId("active")).toHaveTextContent("true"); });
  it("blurs and releases on idle pause", () => { render(<Probe desktop />); const input = screen.getByTestId("input"); fireEvent.click(screen.getByText("arm")); act(() => setLocked(true)); expect(document.activeElement).not.toBe(input); expect(screen.getByTestId("active")).toHaveTextContent("false"); });
});
