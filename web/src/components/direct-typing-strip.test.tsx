import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DirectTypingStrip } from "./direct-typing-strip";

describe("DirectTypingStrip", () => {
  it("shows the active state and stops", () => { const stop = vi.fn(); render(<DirectTypingStrip onStop={stop} />); expect(screen.getByText("Typing into terminal")).toBeInTheDocument(); expect(screen.getByText(/keys go straight through/)).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Stop" })); expect(stop).toHaveBeenCalledOnce(); });
  it("shows a reason without a stop control when disabled", () => { render(<DirectTypingStrip onStop={vi.fn()} disabled reason="pane is gone" />); expect(screen.getByText(/pane is gone/)).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Stop" })).toBeNull(); });
});
