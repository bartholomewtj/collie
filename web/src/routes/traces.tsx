import { useLocation, useNavigate, useParams, useRouteLoaderData, useSearchParams } from "react-router";

import { AppHeader } from "@/components/app-header";
import { LanesIcon, SssfFrame } from "@/components/sssf-frame";
import { StatusArea } from "@/components/status-area";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { timeAgoShort } from "@/lib/format";
import { panePath, tracePath, tracesPath } from "@/lib/nav";
import { paneDisplayName, type AgentView, type PaneSssfRun } from "@/lib/types";
import { cn } from "@/lib/utils";

// Traces — the bottom bar's SSSF destination. Two screens: the LIST (one row per repo the bridge
// found near any space's panes, the running one dotted) and one repo's VISUALISER, full screen with
// a header back to the list. Before this the visualiser was a pseudo-tab inside the space screen,
// reached from a pane by a query-param hop with its own "back to terminal" chip; a destination of
// its own gives it the same list → detail → back shape as everything else.

export interface TraceRow {
  spaceId: string;
  spaceLabel: string;
  repo: string;
  state: "ready" | "pending";
  running: boolean;
  /** This repo is the workspace's attached one and has a live run — open straight on it. */
  liveAdwId?: string;
}

/** Flatten the per-workspace `sssf` stamps into rows, deduped by repo name (a repo parked under
 *  several spaces' panes shows once, under the first space that carries it). Running first, then
 *  ready, then pending. */
export function traceRows(data: Pick<HomeData, "workspaces">): TraceRow[] {
  const seen = new Set<string>();
  const rows: TraceRow[] = [];
  for (const w of data.workspaces) {
    if (!w.sssf) continue;
    for (const r of w.sssf.repos) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      const attached = w.sssf.attached?.repo === r.name ? w.sssf.attached : undefined;
      rows.push({
        spaceId: w.workspaceId,
        spaceLabel: w.label,
        repo: r.name,
        state: r.state,
        running: r.running,
        liveAdwId: attached?.adwId,
      });
    }
  }
  const rank = (r: TraceRow) => (r.running ? 0 : r.state === "ready" ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b));
}

export function TracesRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const stalled = useLoadingStalled();
  const navigate = useNavigate();
  const rows = traceRows(data);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col">
      <AppHeader bridge={data.bridge} error={data.error} stalled={stalled} wordmark />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <main className="flex-1 px-3 py-4">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Traces <span className="tabular-nums">({rows.length})</span>
          </h2>
          {rows.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              No SSSF traces near any space yet.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border/60">
              {rows.map((r) => {
                const pending = r.state === "pending";
                return (
                  <button
                    key={r.repo}
                    type="button"
                    disabled={pending}
                    title={pending ? "No traces yet — run an ADW in this repo" : undefined}
                    onClick={() => navigate(tracePath(r.spaceId, r.repo, data.session))}
                    className={cn(
                      "flex w-full items-center gap-3 px-2.5 py-3 text-left transition-colors hover:bg-muted/50 active:scale-[0.99]",
                      pending && "opacity-50",
                    )}
                  >
                    <LanesIcon className={cn("size-5 shrink-0", pending && "grayscale")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{r.repo}</span>
                        {r.running && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
                            running
                          </span>
                        )}
                        {pending && <span className="text-[11px] text-muted-foreground">no traces yet</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{r.spaceLabel}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </main>
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-screen-sm px-3 pb-[calc(env(safe-area-inset-bottom)_+_4rem)]">
        <StatusArea />
      </div>
    </div>
  );
}

/** The pane a `?pane=` scope names, from either pane list. Undefined when it has closed. */
export function scopedPane(data: Pick<HomeData, "agents" | "shellPanes">, paneId: string | undefined): AgentView | undefined {
  if (!paneId) return undefined;
  return data.agents.find((p) => p.paneId === paneId) ?? data.shellPanes.find((p) => p.paneId === paneId);
}

/** Which run the frame opens on: an explicit `?adw=` first; else, scoped to a pane, that pane's
 *  newest run in THIS repo; else the workspace's live run (the unscoped default). */
export function openOnRun(
  adwParam: string | undefined,
  paneRuns: readonly PaneSssfRun[],
  repo: string,
  live: string | undefined,
): string | undefined {
  return adwParam ?? paneRuns.find((r) => r.repo === repo)?.adwId ?? live;
}

/** One pane's runs as a chip row above the frame — tap one to open the frame on it (a `replace`
 *  navigation, so back still returns to the pane). Runs may live in different repos; a chip from
 *  another repo re-points the frame at that repo's db. */
function RunChips({
  runs,
  current,
  onPick,
}: {
  runs: readonly PaneSssfRun[];
  current: string | undefined;
  onPick: (run: PaneSssfRun) => void;
}) {
  return (
    <div role="list" aria-label="ADW runs from this pane" className="flex gap-1.5 overflow-x-auto px-3 py-2">
      {runs.map((r) => {
        const active = r.adwId === current;
        const running = r.status === "running";
        const started = Date.parse(r.startedAt);
        return (
          <button
            key={`${r.repo}/${r.adwId}`}
            type="button"
            role="listitem"
            aria-current={active ? "true" : undefined}
            onClick={() => onPick(r)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
              active ? "border-foreground/40 bg-muted font-medium" : "border-border/60 text-muted-foreground active:bg-muted/60",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                running ? "bg-emerald-400" : r.status === "success" ? "bg-sky-400" : r.status === "fail" ? "bg-rose-400" : "bg-muted-foreground/50",
              )}
            />
            <span className="font-mono">{r.adwId}</span>
            {r.adwName && <span className="max-w-32 truncate">{r.adwName}</span>}
            <span className="tabular-nums opacity-70">{running ? "running" : Number.isFinite(started) ? timeAgoShort(started) : ""}</span>
            <span className="opacity-60">· {r.repo}</span>
          </button>
        );
      })}
    </div>
  );
}

// One repo's visualiser, full screen. The frame is the sole scroller (the visualiser scrolls inside
// itself; a pull at its top must not reload the PWA). Header back returns to the Traces list. The
// run to open on is read once at mount (SssfFrame pins it), so a later snapshot can't yank the view.
//
// Scoped to a pane (`?pane=`, from the pane header's Traces button): the header names the pane, a
// chip row lists the runs that pane launched (newest first, across repos), the frame opens on the
// newest one in this repo, and back returns to the PANE — this is a screen below the pane then, the
// same shape as history. `?adw=` pins one run and remounts the frame on it.
export function TraceRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const { spaceId = "", repo = "" } = useParams();
  const [search] = useSearchParams();
  const paneId = search.get("pane") ?? undefined;
  const adwParam = search.get("adw") ?? undefined;
  const stalled = useLoadingStalled();
  const navigate = useNavigate();
  const ws = data.workspaces.find((w) => w.workspaceId === spaceId);
  const sssf = ws?.sssf;
  // ‹ returns where you came from when the opener said (a space's tab heading), else the scoping
  // pane, else the Traces list — same rule as the pane's back.
  const from = (useLocation().state as { from?: string } | null)?.from;
  const back = () => navigate(from ?? (paneId ? panePath(paneId, data.session) : tracesPath(data.session)));
  const live = sssf?.attached?.repo === repo ? sssf.attached.adwId : undefined;
  const pane = scopedPane(data, paneId);
  const paneRuns = pane?.sssf?.runs ?? [];
  const openOn = openOnRun(adwParam, paneRuns, repo, live);
  const pick = (r: PaneSssfRun) =>
    navigate(tracePath(spaceId, r.repo, data.session, { pane: paneId, adw: r.adwId }), { replace: true });

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col">
      <AppHeader bridge={data.bridge} error={data.error} stalled={stalled} onBack={back}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <LanesIcon className="size-5 shrink-0" />
          <div className="min-w-0">
            <div className="truncate font-semibold leading-tight">{repo}</div>
            {paneId ? (
              <div className="truncate text-xs leading-tight text-muted-foreground">
                runs from {pane ? paneDisplayName(pane) : "a closed pane"}
              </div>
            ) : (
              ws && <div className="truncate text-xs leading-tight text-muted-foreground">{ws.label}</div>
            )}
          </div>
        </div>
      </AppHeader>
      {paneId && paneRuns.length > 0 && <RunChips runs={paneRuns} current={openOn} onPick={pick} />}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {ws && sssf ? (
          // Keyed on the URL-pinned run only: a chip tap remounts on its run; a later snapshot
          // changing the derived default does not.
          <SssfFrame
            key={`${spaceId}:${repo}:${adwParam ?? ""}`}
            workspace={ws}
            sssf={sssf}
            session={data.session}
            repo={repo}
            adwId={openOn}
          />
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {data.bridge === "connected" ? "No traces for this repo." : "Connecting…"}
          </p>
        )}
      </main>
    </div>
  );
}
