import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useDirectTyping } from "./use-direct-typing";
import { pasteHold, __resetPasteHold } from "@/lib/paste-hold";

let lastSend: ReturnType<typeof vi.fn>;
function Probe({ desktop = true, image = false }: { desktop?: boolean; image?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef(vi.fn(async () => true)); const send = sendRef.current; lastSend = send;
  const direct = useDirectTyping({ paneKey: "session\0p", inputRef: ref, replyDraft: () => "", canActivate: () => true, suspended: false, sendKeys: send, onActivate: vi.fn(), focusInput: () => ref.current?.focus(), desktop, uploadImage: image ? async () => "/host/shot.png" : undefined });
  return <><textarea ref={ref} onBlur={direct.onBlur} data-testid="input" /><button onClick={direct.activate}>arm</button></>;
}
function paste(text: string, items: unknown[] = []) { const event = new Event("paste", { bubbles: true, cancelable: true }); Object.defineProperty(event, "clipboardData", { value: { getData: () => text, items } }); act(() => screen.getByTestId("input").dispatchEvent(event)); return event; }
afterEach(() => { cleanup(); __resetPasteHold(); });
describe("desktop paste", () => {
  it("sends ordinary single-line text", async () => { render(<Probe />); fireEvent.click(screen.getByText("arm")); await new Promise((resolve) => setTimeout(resolve, 0)); expect(paste("echo hi").defaultPrevented).toBe(true); await waitFor(() => expect(lastSend).toHaveBeenCalledWith(["e", "c", "h", "o", "Space", "h", "i"])); expect(pasteHold()).toBeNull(); });
  it("holds multiline and sends interior Enter without trailing Enter", async () => { render(<Probe />); fireEvent.click(screen.getByText("arm")); paste("echo a\necho b\n"); expect(pasteHold()?.kind).toBe("text"); pasteHold()?.onSend(); expect(lastSend.mock.calls[0][0]).toContain("Enter"); expect(lastSend.mock.calls[0][0].at(-1)).not.toBe("Enter"); });
  it("holds destructive text and discards", async () => { render(<Probe />); fireEvent.click(screen.getByText("arm")); paste("rm -rf /tmp/x"); expect(pasteHold()?.kind).toBe("text"); pasteHold()?.onDiscard(); expect(pasteHold()).toBeNull(); expect(lastSend).not.toHaveBeenCalled(); });
  it("holds image without typing until Type path", async () => { render(<Probe image />); fireEvent.click(screen.getByText("arm")); const file = new File(["x"], "shot.png", { type: "image/png" }); paste("", [{ kind: "file", type: "image/png", getAsFile: () => file }]); await vi.waitFor(() => expect(pasteHold()?.kind).toBe("path")); expect(lastSend).not.toHaveBeenCalled(); pasteHold()?.onSend(); expect(lastSend).toHaveBeenCalled(); });
  it("clears on blur", async () => { render(<Probe />); fireEvent.click(screen.getByText("arm")); paste("a\nb"); fireEvent.blur(screen.getByTestId("input")); expect(pasteHold()).toBeNull(); });
  it("does nothing on phone", async () => { render(<Probe desktop={false} />); fireEvent.click(screen.getByText("arm")); expect(paste("x").defaultPrevented).toBe(false); });
});
