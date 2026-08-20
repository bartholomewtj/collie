import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { server } from "@/test/setup";
import { ROOT_ROUTE_ID, type HistoryData, type HomeData } from "@/lib/loaders";
import type { AgentView, TranscriptEntry } from "@/lib/types";
import { HistoryRoute, mergeNewest } from "./history";

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

function makeEntry(uuid: string, text: string, role: "user" | "assistant" = "user"): TranscriptEntry {
  return {
    uuid,
    ts: "2026-08-20T00:00:00.000Z",
    role,
    parts: [{ kind: "text", text }],
  };
}

describe("mergeNewest", () => {
  it("returns fresh when prev is empty", () => {
    const fresh = [makeEntry("t1", "hello")];
    expect(mergeNewest([], fresh)).toBe(fresh);
  });

  it("splices overlapping turns by replacing and appending", () => {
    const prev = [
      makeEntry("t1", "initial 1"),
      makeEntry("t2", "initial 2"),
    ];
    const fresh = [
      makeEntry("t2", "updated 2"),
      makeEntry("t3", "new 3"),
    ];
    const result = mergeNewest(prev, fresh);
    expect(result).toHaveLength(3);
    expect(result[0]?.uuid).toBe("t1");
    expect(result[1]?.uuid).toBe("t2");
    expect(result[1]?.parts[0]).toEqual({ kind: "text", text: "updated 2" });
    expect(result[2]?.uuid).toBe("t3");
  });

  it("returns fresh when there is no uuid overlap (wholesale replacement)", () => {
    const prev = [makeEntry("t1", "old session")];
    const fresh = [makeEntry("t2", "new session")];
    expect(mergeNewest(prev, fresh)).toBe(fresh);
  });
});

function makeHomeData(agentStatus: AgentView["status"] = "idle"): HomeData {
  return {
    bridge: "connected",
    agents: [
      {
        paneId: "w1:p1",
        workspaceId: "w1",
        workspaceLabel: "collie",
        workspaceNumber: 1,
        tabId: "w1:t1",
        agent: "claude",
        status: agentStatus,
        cwd: "/home",
        focused: false,
        hasSession: true,
      },
    ],
    shellPanes: [],
    workspaces: [],
    tabs: [],
    device: undefined,
    sessions: [],
    session: undefined,
    snoozedUntil: null,
    update: undefined,
    error: false,
    authError: false,
  };
}

describe("HistoryRoute — live freshness", () => {
  it("updates the rendered transcript when agent status changes", async () => {
    let currentStatus: AgentView["status"] = "working";
    let historyResponse: { entries: TranscriptEntry[]; total: number; hasMore: boolean } = {
      entries: [makeEntry("t1", "initial message")],
      total: 1,
      hasMore: false,
    };

    server.use(
      http.get(/\/api\/pane\/[^/]+\/history/, () =>
        HttpResponse.json({
          paneId: "w1:p1",
          available: true,
          ...historyResponse,
          fileTruncated: false,
        }),
      ),
    );

    const initialHistory: HistoryData = {
      paneId: "w1:p1",
      session: undefined,
      entries: [makeEntry("t1", "initial message")],
      hasMore: false,
      total: 1,
      fileTruncated: false,
    };

    const router = createMemoryRouter(
      [
        {
          id: ROOT_ROUTE_ID,
          path: "/",
          loader: () => makeHomeData(currentStatus),
          element: <Outlet />,
          children: [
            {
              path: "pane/:paneId/history",
              loader: () => initialHistory,
              element: <HistoryRoute />,
            },
          ],
        },
      ],
      { initialEntries: ["/pane/w1:p1/history"] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText("initial message")).toBeInTheDocument();
    expect(screen.queryByText("second message")).not.toBeInTheDocument();

    // Prepare fresh history response with an appended turn
    historyResponse = {
      entries: [
        makeEntry("t1", "initial message"),
        makeEntry("t2", "second message"),
      ],
      total: 2,
      hasMore: false,
    };

    // Transition status to idle — triggers status effect and refreshNewest
    currentStatus = "idle";
    await act(async () => {
      await router.revalidate();
    });

    expect(await screen.findByText("second message")).toBeInTheDocument();
    expect(screen.getByText("initial message")).toBeInTheDocument();
  });

  it("replaces the whole transcript when fresh response has zero uuid overlap", async () => {
    let currentStatus: AgentView["status"] = "working";
    let historyResponse: { entries: TranscriptEntry[]; total: number; hasMore: boolean } = {
      entries: [makeEntry("old1", "turn from old session")],
      total: 1,
      hasMore: false,
    };

    server.use(
      http.get(/\/api\/pane\/[^/]+\/history/, () =>
        HttpResponse.json({
          paneId: "w1:p1",
          available: true,
          ...historyResponse,
          fileTruncated: false,
        }),
      ),
    );

    const initialHistory: HistoryData = {
      paneId: "w1:p1",
      session: undefined,
      entries: [makeEntry("old1", "turn from old session")],
      hasMore: false,
      total: 1,
      fileTruncated: false,
    };

    const router = createMemoryRouter(
      [
        {
          id: ROOT_ROUTE_ID,
          path: "/",
          loader: () => makeHomeData(currentStatus),
          element: <Outlet />,
          children: [
            {
              path: "pane/:paneId/history",
              loader: () => initialHistory,
              element: <HistoryRoute />,
            },
          ],
        },
      ],
      { initialEntries: ["/pane/w1:p1/history"] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText("turn from old session")).toBeInTheDocument();

    // Prepare fresh response from a new session (/clear)
    historyResponse = {
      entries: [makeEntry("new1", "turn from new session")],
      total: 1,
      hasMore: false,
    };

    currentStatus = "idle";
    await act(async () => {
      await router.revalidate();
    });

    expect(await screen.findByText("turn from new session")).toBeInTheDocument();
    expect(screen.queryByText("turn from old session")).not.toBeInTheDocument();
  });
});
