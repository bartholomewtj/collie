import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/hooks/use-idle-lock", () => ({ useIdleLock: vi.fn(() => ({ locked: false, unlock: vi.fn() })) }));
vi.mock("@/lib/desktop", () => ({ useDesktop: vi.fn(() => ({ on: false, typing: "composer" })) }));
vi.mock("@/router", () => ({ router: {} }));
vi.mock("react-router", () => ({ RouterProvider: () => null }));
vi.mock("@/components/busy-bar", () => ({ BusyBar: () => null }));
vi.mock("@/components/idle-lock", () => ({ IdleLock: () => null }));
vi.mock("@/lib/idle", () => ({ useCatchingUp: () => false }));
import { App } from "./App";
import { useIdleLock } from "@/hooks/use-idle-lock";
import { useDesktop } from "@/lib/desktop";

describe("App desktop idle duration", () => {
  it("uses the phone duration by default", () => { render(<App />); expect(useIdleLock).toHaveBeenCalledWith(30 * 60 * 1000); });
  it("uses the desktop duration when enabled", () => { vi.mocked(useDesktop).mockReturnValue({ on: true, typing: "composer" }); render(<App />); expect(useIdleLock).toHaveBeenCalledWith(2 * 60 * 60 * 1000); });
});
