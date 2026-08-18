import { useNavigate, useParams, useRouteLoaderData } from "react-router";

import { AppHeader } from "@/components/app-header";
import { LanesIcon, SssfFrame } from "@/components/sssf-frame";
import { StatusArea } from "@/components/status-area";
import { useLoadingStalled } from "@/hooks/use-loading-stalled";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { tracePath, tracesPath } from "@/lib/nav";
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

// One repo's visualiser, full screen. The frame is the sole scroller (the visualiser scrolls inside
// itself; a pull at its top must not reload the PWA). Header back returns to the Traces list. The
// run to open on is read once at mount (SssfFrame pins it), so a later snapshot can't yank the view.
export function TraceRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const { spaceId = "", repo = "" } = useParams();
  const stalled = useLoadingStalled();
  const navigate = useNavigate();
  const ws = data.workspaces.find((w) => w.workspaceId === spaceId);
  const sssf = ws?.sssf;
  const back = () => navigate(tracesPath(data.session));
  const live = sssf?.attached?.repo === repo ? sssf.attached.adwId : undefined;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-screen-sm flex-1 flex-col">
      <AppHeader bridge={data.bridge} error={data.error} stalled={stalled} onBack={back}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <LanesIcon className="size-5 shrink-0" />
          <div className="min-w-0">
            <div className="truncate font-semibold leading-tight">{repo}</div>
            {ws && <div className="truncate text-xs leading-tight text-muted-foreground">{ws.label}</div>}
          </div>
        </div>
      </AppHeader>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {ws && sssf ? (
          <SssfFrame key={`${spaceId}:${repo}`} workspace={ws} sssf={sssf} session={data.session} repo={repo} adwId={live} />
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {data.bridge === "connected" ? "No traces for this repo." : "Connecting…"}
          </p>
        )}
      </main>
    </div>
  );
}
