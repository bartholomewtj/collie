import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLongPress, type LongPressPoint } from "./use-long-press";

function Row({ onLongPress, disabled }: { onLongPress: (at: LongPressPoint) => void; disabled: boolean }) {
  return <button {...useLongPress(onLongPress, { disabled })}>row</button>;
}

describe("useLongPress desktop mode", () => {
  afterEach(() => vi.useRealTimers());

  it("disabled skips a held pointer but contextmenu still opens at its point", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    render(<Row onLongPress={callback} disabled />);
    const row = screen.getByRole("button");
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 20 });
    act(() => vi.advanceTimersByTime(451));
    expect(callback).not.toHaveBeenCalled();

    const event = fireEvent.contextMenu(row, { clientX: 120, clientY: 200 });
    expect(event).toBe(false); // React's fireEvent returns false when preventDefault was called.
    expect(callback).toHaveBeenCalledWith({ x: 120, y: 200 });
  });

  it("disabled permits a second right click after the first", () => {
    const callback = vi.fn();
    render(<Row onLongPress={callback} disabled />);
    const row = screen.getByRole("button");
    fireEvent.contextMenu(row, { clientX: 1, clientY: 2 });
    fireEvent.pointerDown(row, { button: 2 });
    fireEvent.contextMenu(row, { clientX: 3, clientY: 4 });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("phone mode still fires the hold and contextmenu", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    render(<Row onLongPress={callback} disabled={false} />);
    const row = screen.getByRole("button");
    fireEvent.pointerDown(row, { button: 0, clientX: 30, clientY: 40 });
    act(() => vi.advanceTimersByTime(450));
    expect(callback).toHaveBeenCalledWith({ x: 30, y: 40 });
    fireEvent.contextMenu(row, { clientX: 50, clientY: 60 });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("uses the row rect for a keyboard context menu", () => {
    const callback = vi.fn();
    render(<Row onLongPress={callback} disabled />);
    const row = screen.getByRole("button");
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ left: 40, bottom: 90 } as DOMRect);
    fireEvent.contextMenu(row);
    expect(callback).toHaveBeenCalledWith({ x: 40, y: 90 });
  });
});
