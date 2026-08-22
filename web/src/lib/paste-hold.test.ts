import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPasteHold, onPasteHoldChange, pasteHold, setPasteHold, __resetPasteHold } from "./paste-hold";

afterEach(__resetPasteHold);
describe("paste hold", () => {
  it("stores and clears a pending paste", () => {
    const onSend = vi.fn();
    setPasteHold({ kind: "text", lines: 2, reason: null, onSend, onDiscard: vi.fn() });
    expect(pasteHold()?.kind).toBe("text");
    clearPasteHold();
    expect(pasteHold()).toBeNull();
  });
  it("notifies subscribers and supports unsubscribe", () => {
    const listener = vi.fn();
    const off = onPasteHoldChange(listener);
    setPasteHold({ kind: "text", lines: 1, reason: null, onSend: vi.fn(), onDiscard: vi.fn() });
    expect(listener).toHaveBeenCalledOnce(); off(); clearPasteHold(); expect(listener).toHaveBeenCalledOnce();
  });
  it("is safe with no subscribers", () => { expect(() => { clearPasteHold(); setPasteHold(null); }).not.toThrow(); });
});
