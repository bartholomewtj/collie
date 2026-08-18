import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { WorkspaceView } from "@/lib/types";
import { SssfFrame, sssfFrameSrc } from "./sssf-frame";

const ws: WorkspaceView = {
  workspaceId: "w1",
  number: 1,
  label: "home",
  focused: false,
  activeTabId: "t1",
  tabCount: 1,
  paneCount: 1,
};

describe("sssfFrameSrc — what the bridge and the visualiser read off the frame URL", () => {
  it("carries ws, token and embed; session and repo only when given; the hash is the visualiser route", () => {
    expect(sssfFrameSrc("w1", "tok", undefined)).toBe("/sssf/?ws=w1&t=tok&embed=1#/");
    expect(sssfFrameSrc("w1", "tok", "primary", "collie")).toBe("/sssf/?ws=w1&t=tok&embed=1&session=primary&repo=collie#/");
    expect(sssfFrameSrc("w1", "tok", undefined, "collie", "e7b38c61")).toBe("/sssf/?ws=w1&t=tok&embed=1&repo=collie#/e7b38c61");
  });

  it("encodes the run id into the hash rather than trusting it", () => {
    expect(sssfFrameSrc("w1", "tok", undefined, "r", "a/b#c")).toBe("/sssf/?ws=w1&t=tok&embed=1&repo=r#/a%2Fb%23c");
  });
});

describe("SssfFrame — the run to open on is pinned at mount", () => {
  it("keeps the first adwId even when the prop later changes; a repo/token change still flows through", () => {
    const sssf = { state: "ready" as const, token: "tok", repos: [] };
    const { rerender } = render(<SssfFrame workspace={ws} sssf={sssf} session={undefined} repo="a" adwId="run1" hidden={false} />);
    const frame = () => screen.getByTitle("SSSF traces — home") as HTMLIFrameElement;
    expect(frame().getAttribute("src")).toBe("/sssf/?ws=w1&t=tok&embed=1&repo=a#/run1");
    rerender(<SssfFrame workspace={ws} sssf={{ ...sssf, token: "tok2" }} session={undefined} repo="a" adwId="run2" hidden={false} />);
    expect(frame().getAttribute("src")).toBe("/sssf/?ws=w1&t=tok2&embed=1&repo=a#/run1");
    expect(frame().getAttribute("sandbox")).toBe("allow-scripts");
  });
});
