import { buildFreshness } from "./build-freshness.ts";
import type { ActivityLedger } from "./activity.ts";
import type { Config } from "./config.ts";
import { checkAccess, deviceAuth, guard } from "./access.ts";
import { json, jsonError, text } from "./responses.ts";
import { buildId, WEB_ROOT, withBuildHeader } from "./static-assets.ts";
import { adapterFor } from "./journal/registry.ts";
import type { JournalAdapter } from "./journal/types.ts";
import { TranscriptStore } from "./journal/store.ts";
import { agentCwdKey, countPanesPerAgentCwd } from "./pane-read-routes.ts";
import type { SessionRegistry } from "./sessions.ts";
import type { Snooze } from "./snooze.ts";
import type { Push } from "./push.ts";
import type { UpdateMonitor } from "./update.ts";
import type { createSssfViz } from "./sssf-viz.ts";
import type { createWorkdir } from "./workdir.ts";
import { toPaneWire, type AgentView, type BridgeConfig, type SnapshotResponse } from "./types.ts";

export interface SnapshotDeps {
  cfg: Config; registry: SessionRegistry; activity: ActivityLedger; snooze: Snooze; updateMonitor: UpdateMonitor;
  sssfViz: ReturnType<typeof createSssfViz>; workdir: ReturnType<typeof createWorkdir>;
  journals: Record<string, JournalAdapter> | null; transcripts: TranscriptStore | null;
  offerHistory: (agent: string, hasSessionRef: boolean) => boolean; sessionName: string | undefined;
}

export async function snapshotRoute(req: Request, deps: SnapshotDeps): Promise<Response> {
  const unknownSession = () => jsonError(`unknown session: ${deps.sessionName ?? ""}`, 404, req.headers.get("accept-encoding"));
  const gate = checkAccess(req, deps.cfg);
  if (!gate.ok) return text(gate.reason, 403);
  const rt = deps.registry.get(deps.sessionName);
  if (!rt) return unknownSession();
  const { agents, shellPanes, workspaces, tabs, bridge } = rt.engine.current();
  const device = deviceAuth(req, deps.cfg);
  // Attach each pane's deps.activity timestamps. Done here rather than in the state engine so the
  // engine stays a pure Herdr-poller with no knowledge of the ledger — and so the two numbers
  // are read at serialise time, i.e. as fresh as the request.
  const withActivity = (p: AgentView): AgentView => {
    const a = deps.activity.get(rt.name, p.paneId);
    return a ? { ...p, lastActiveAt: a.activeAt, lastSeenAt: a.seenAt } : p;
  };
  // Decorate working agent panes with runningCommand when their journal tail shows a tool
  // call with no result yet. Stamped at serialise time (like withActivity) so the state engine
  // stays a pure Herdr poller. Omitted when deps.cfg.transcript is off (deps.transcripts is null).
  const cwdMateCount = countPanesPerAgentCwd(agents);
  const decoratedAgents =
    deps.transcripts && deps.journals
      ? await Promise.all(
          agents.map(async (p) => {
            if (p.status !== "working") return p;
            try {
              const adapter = adapterFor(deps.journals!, p.agent);
              if (!adapter) return p;
              const ref =
                p.agentSession ??
                (adapter.inferFromCwd && p.cwd
                  ? await adapter.inferFromCwd({
                      cwd: p.cwd,
                      paneId: p.paneId,
                      hint: p.terminalTitle,
                      sharedCwd: (cwdMateCount.get(agentCwdKey(p)) ?? 0) > 1,
                    })
                  : null);
              if (!ref) return p;
              const running = await deps.transcripts!.runningCommand(adapter, ref);
              return running === true ? { ...p, runningCommand: true } : p;
            } catch {
              return p;
            }
          }),
        )
      : agents;
  // Tag every snapshot poll with the on-disk build id so an open client notices a live rebuild
  // between polls — the no-service-worker self-update path (web/src/lib/self-update.ts).
  return withBuildHeader(
    json({
      bridge,
      // Only report device state when the feature is on, so an off deployment sends nothing new.
      ...(device.enforced ? { device } : {}),
      // The one place a pane leaves the bridge: the session ref is stripped to a presence flag
      // here, so an agent-reported filesystem path never reaches a browser (see toPaneWire).
      // The flag is computed against the deps.registry, so a harness Herdr detects but Collie has no
      // journal for doesn't advertise a History button that can only ever come back empty.
      // withActivity runs FIRST: it returns an AgentView, which is what toPaneWire consumes,
      // and the two timestamps then ride through its rest-spread onto the wire shape.
      // decoratePanes hangs each pane's ADW runs on it (bridge/sssf-viz.ts) — a plain stamp
      // from the last discovery pass, so it costs no I/O here; identity when the feature is off.
      agents: deps.sssfViz.decoratePanes(decoratedAgents, deps.sessionName).map((p) => toPaneWire(withActivity(p), deps.offerHistory)),
      shellPanes: deps.sssfViz.decoratePanes(shellPanes, deps.sessionName).map((p) => toPaneWire(withActivity(p), deps.offerHistory)),
      // Keyed by the REQUEST's session param (undefined on the primary session), not rt.name:
      // the Traces frame sends the same param back on /sssf/api/*, and the two must match or
      // the primary session's db is never found (404 "no traces", found live 2026-08-18).
      workspaces: deps.sssfViz.decorate(workspaces, [...agents, ...shellPanes], deps.sessionName),
      tabs,
      sessions: deps.registry.list(),
      notifications: { snoozedUntil: deps.snooze.until() },
      update: deps.updateMonitor.status(),
      ...(deps.workdir.enabled ? { files: true as const } : {}),
      ts: Date.now(),
    } satisfies SnapshotResponse, req.headers.get("accept-encoding")),
    await buildId(),
  );
}

export interface BridgeConfigDeps {
  cfg: Config; push: Push; operatorCommands: ReturnType<typeof import("./operator-commands.ts").createOperatorCommands>; operatorQuickReplies: ReturnType<typeof import("./operator-commands.ts").createOperatorQuickReplies>; operatorKeys: ReturnType<typeof import("./operator-keys.ts").createOperatorKeys>;
}
export async function bridgeConfigRoute(req: Request, deps: BridgeConfigDeps): Promise<Response> {
  const denied = guard(req, deps.cfg, "read");
  if (denied) return denied;
  // Re-read per request behind an mtime check, like buildId() — editing commands.toml is live,
  // with no restart. The path is deps.cfg's, never the request's.
  const mine = await deps.operatorCommands();
  const quick = await deps.operatorQuickReplies();
  const myKeys = await deps.operatorKeys();
  return json({
    push: deps.push.enabled,
    vapidPublicKey: deps.push.publicKey,
    build: await buildId(),
    // Only when true, so the common (healthy) payload is byte-identical to before.
    ...((await buildFreshness(WEB_ROOT)).stale ? { staleBuild: true as const } : {}),
    // Omitted entirely when there are none, so an operator who never wrote a commands.toml
    // ships the same payload as before.
    ...(mine.length > 0 ? { operatorCommands: mine } : {}),
    ...(quick.length > 0 ? { operatorQuickReplies: quick } : {}),
    ...(myKeys.length > 0 ? { operatorKeys: myKeys } : {}),
  } satisfies BridgeConfig, req.headers.get("accept-encoding"));
}
