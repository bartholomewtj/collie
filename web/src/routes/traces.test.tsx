import { describe, expect, it } from "vitest";

import type { WorkspaceView } from "@/lib/types";
import { traceRows } from "./traces";

const ws = (id: string, label: string, sssf?: WorkspaceView["sssf"]): WorkspaceView => ({
  workspaceId: id,
  number: 1,
  label,
  focused: false,
  activeTabId: "t1",
  tabCount: 1,
  paneCount: 1,
  sssf,
});

describe("traceRows — the Traces list is one row per repo across every space", () => {
  it("skips spaces without traces, dedupes a repo seen under two spaces, and puts running first", () => {
    const rows = traceRows({
      workspaces: [
        ws("w0", "plain"),
        ws("w1", "home", {
          state: "ready",
          token: "t",
          repos: [
            { name: "collie", state: "ready", running: false },
            { name: "soon", state: "pending", running: false },
          ],
        }),
        ws("w2", "lab", {
          state: "ready",
          token: "t",
          repos: [
            { name: "collie", state: "ready", running: false }, // duplicate — first space wins
            { name: "gene", state: "ready", running: true },
          ],
          attached: { repo: "gene", adwId: "run9" },
        }),
      ],
    });
    expect(rows.map((r) => [r.repo, r.spaceLabel, r.running, r.liveAdwId])).toEqual([
      ["gene", "lab", true, "run9"],
      ["collie", "home", false, undefined],
      ["soon", "home", false, undefined],
    ]);
  });
});
