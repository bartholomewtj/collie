import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DisplayPrefsContent } from "./display-prefs";
import { setDesktop, __resetDesktop } from "@/lib/desktop";

afterEach(() => { cleanup(); __resetDesktop(); });
const props = { prefs: { fontSize: 12, rawTerminal: true, tapToFocus: true }, stepFontSize: () => {}, setRawTerminal: () => {}, setTapToFocus: () => {} };
describe("display preferences in desktop mode", () => {
  it("keeps Tap to type on phones", () => { render(<DisplayPrefsContent {...props} />); expect(screen.getByText("Tap to type")).toBeInTheDocument(); });
  it("hides Tap to type on desktop but keeps Raw terminal", () => { setDesktop(true); render(<DisplayPrefsContent {...props} />); expect(screen.queryByText("Tap to type")).toBeNull(); expect(screen.getByText("Raw terminal")).toBeInTheDocument(); });
});
