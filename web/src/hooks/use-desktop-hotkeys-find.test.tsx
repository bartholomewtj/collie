import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { useDesktopHotkeys } from "./use-desktop-hotkeys";
import { __resetDesktop, setDesktop } from "@/lib/desktop";
import { __resetDirectArm, setDirectArmed } from "@/lib/direct-arm";
import { onFindOpenRequest } from "@/lib/find-request";

describe("desktop Ctrl+F", () => {
  beforeEach(() => { __resetDesktop(); setDesktop(true); __resetDirectArm(); });
  afterEach(() => { cleanup(); __resetDesktop(); __resetDirectArm(); });
  function mount(pane?: string) { function Probe(){ useDesktopHotkeys({agents:[],currentPaneId:pane}); return null; } return render(<RouterProvider router={createMemoryRouter([{path:"*",element:<Probe/>}])}/>); }
  function dispatch(options: KeyboardEventInit={}) { const event=new KeyboardEvent("keydown",{key:"f",ctrlKey:true,cancelable:true,...options}); act(()=>window.dispatchEvent(event)); return event; }
  it("opens find only on an unarmed pane", () => { const fn=vi.fn(); const off=onFindOpenRequest(fn); mount("p"); expect(dispatch().defaultPrevented).toBe(true); expect(fn).toHaveBeenCalledOnce(); off(); });
  it("declines while armed and outside panes", () => { const fn=vi.fn(); const off=onFindOpenRequest(fn); const {unmount}=mount("p"); setDirectArmed(true); expect(dispatch().defaultPrevented).toBe(false); unmount(); mount(); expect(dispatch().defaultPrevented).toBe(false); expect(fn).not.toHaveBeenCalled(); off(); });
  it("does not claim other chords", () => { const fn=vi.fn(); const off=onFindOpenRequest(fn); mount("p"); expect(dispatch({shiftKey:true}).defaultPrevented).toBe(false); expect(dispatch({altKey:true}).defaultPrevented).toBe(false); expect(dispatch({ctrlKey:false}).defaultPrevented).toBe(false); expect(fn).not.toHaveBeenCalled(); off(); });
  it("unsubscribes after unmount", () => { const fn=vi.fn(); const off=onFindOpenRequest(fn); const view=mount("p"); view.unmount(); dispatch(); expect(fn).not.toHaveBeenCalled(); off(); });
});
