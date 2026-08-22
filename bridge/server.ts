import type { ActivityLedger } from "./activity.ts";
import type { AuditLog } from "./audit.ts";
import { buildFreshness } from "./build-freshness.ts";
import type { Config } from "./config.ts";
import type { Push } from "./push.ts";

import type { NotifyPrefsStore } from "./notify-prefs.ts";
import { createOperatorCommands, createOperatorQuickReplies } from "./operator-commands.ts";
import { createOperatorKeys } from "./operator-keys.ts";
import type { SessionRegistry } from "./sessions.ts";
import type { Snooze } from "./snooze.ts";
import { createSssfViz } from "./sssf-viz.ts";
import { createWorkdir } from "./workdir.ts";
import type { UpdateMonitor } from "./update.ts";
import { adapterFor, buildJournalRegistry } from "./journal/registry.ts";
import { TranscriptStore } from "./journal/store.ts";

import { isLoopbackPeer, marksPaneSeen, guard, deviceAuth, startupWarnings, isHostAllowed } from "./access.ts";
import { CONTENT_TYPES, CSP, json, jsonError, requireJsonBody, secure, text, failureText, decodePathSegment } from "./responses.ts";
import { WEB_ROOT, serveStatic, isReservedAuthPath, resolveStaticPath, cacheControlFor, reservedAuthPlaceholder } from "./static-assets.ts";
import { readPane, paneHistory } from "./pane-read-routes.ts";
import { replyPane, keysPane, closePane, renamePane, uploadPane } from "./pane-write-routes.ts";
import { renameTab, renameWorkspace, closeTab, createTab, createWorkspace } from "./tree-routes.ts";
import { snapshotRoute, bridgeConfigRoute } from "./snapshot-route.ts";
import { subscribeRoute, snoozeRoute, notifyPrefsRoute, updateCheckRoute } from "./notify-routes.ts";

export { SEEN_HEADER, marksPaneSeen, isLoopbackPeer, isStateChangingMethod, checkAccess, isHostAllowed, guard, deviceAuth, startupWarnings } from "./access.ts";
export { decodePathSegment, failureText, isJsonContentType, requireJsonBody } from "./responses.ts";
export { BUILD_HEADER, withBuildHeader, resolveStaticPath, isReservedAuthPath, cacheControlFor, isPrivateStaticFile } from "./static-assets.ts";
export { paneReadResponse, historyParams } from "./pane-read-routes.ts";
export { sendReplySteps, replyPane, keysPane } from "./pane-write-routes.ts";
export type { ReplySender, ReplyOutcome, SleepFn } from "./pane-write-routes.ts";
export { normalizeLabel } from "./tree-routes.ts";
export { parseNotifyPrefsPatch } from "./notify-routes.ts";

const MAX_REQUEST_BODY_BYTES = 12 * 1024 * 1024;
const PANE_ROUTE = /^\/api\/pane\/([^/]+)(?:\/(reply|keys|upload|close|rename|history))?$/;
const TAB_ACTION_ROUTE = /^\/api\/tab\/([^/]+)\/(rename|close)$/;
const WORKSPACE_ACTION_ROUTE = /^\/api\/workspace\/([^/]+)\/(rename)$/;

export function startServer(opts: {
  cfg: Config;
  registry: SessionRegistry;
  push: Push;
  snooze: Snooze;
  notifyPrefs: NotifyPrefsStore;
  updateMonitor: UpdateMonitor;
  audit: AuditLog;
  activity: ActivityLedger;
}) {
  const { cfg, registry, push, snooze, notifyPrefs, updateMonitor, audit, activity } = opts;
  // One journal registry + store for the process. The store's cache is keyed by absolute path, so
  // sharing it across herdr sessions AND across harnesses is correct — two sessions can front panes
  // whose agents write into the same root. Which harnesses have journals at all is decided in
  // journal/registry.ts, never here.
  // One reader per process; it owns the mtime cache that keeps commands.toml off the hot path.
  const operatorCommands = createOperatorCommands(cfg.commandsFile);
  const operatorQuickReplies = createOperatorQuickReplies(cfg.commandsFile);
  const operatorKeys = createOperatorKeys(cfg.keysFile);
  const journals = cfg.transcript ? buildJournalRegistry(cfg.journalRoots) : null;
  const transcripts = cfg.transcript ? new TranscriptStore() : null;
  // Grok (and any future cwd-keyed harness) can offer history without Herdr naming a session.
  const offerHistory = (agent: string, hasSessionRef: boolean) => {
    const adapter = adapterFor(journals ?? {}, agent);
    return adapter !== undefined && (hasSessionRef || typeof adapter.inferFromCwd === "function");
  };
  // The SSSF traces tab (bridge/sssf-viz.ts). Inert unless SSSF_VIZ_DIR is set; it borrows the
  // gate/static helpers below rather than importing this file back.
  const sssfViz = createSssfViz(cfg, {
    guard, isHostAllowed, requireJsonBody, failureText, resolveStaticPath, cacheControlFor, secure,
    csp: CSP, contentTypes: CONTENT_TYPES,
  });
  const workdir = createWorkdir(cfg, { guard, json, text, failureText, secure, contentTypes: CONTENT_TYPES });
  // Per-session background notifications live in each session's runtime (built by the factory in
  // index.ts, wired to its StateEngine transitions). The routes here only fan preference changes and
  // snooze-clears across every live session's coordinator.

  const server = Bun.serve({
    hostname: cfg.host,
    port: cfg.port,
    // Runtime cap on any request body — a chunked/lying client is cut off here even if its
    // Content-Length is absent or false. The upload handler still does its own precise check.
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,

    // Bun's `development` default is `NODE_ENV !== "production"`, and nothing in Collie's launch paths
    // sets NODE_ENV — so without this the bridge served Bun's HTML error page, stack trace and absolute
    // source paths included, to anyone who could make a handler throw. Pinned in code rather than via a
    // unit Environment= line because the three launch paths in collie-ctl.sh plus the hand-maintained
    // systemd/collie.service copy would all have to agree, and nothing tests that they do.
    development: false,

    // Last line of defence: anything that escapes `fetch` (or a rejected promise a handler returned)
    // lands here instead of Bun's default page. `text()` applies the shared hardening headers, which a
    // raw `new Response` here would skip.
    error(err: unknown) {
      return text(failureText("request", err), 500);
    },

    async fetch(req, srv) {
      // Peer-address gate, ahead of routing so it covers the static PWA too. Under the loopback bind
      // that config.ts enforces this can never fire; it exists so a wide bind reached some other way
      // (a container port-forward, a future bind path, a hand-edited unit) still can't reach a route.
      // Skipped when the operator explicitly opted into a wide bind — there, remote peers are the point.
      if (!cfg.allowNonLoopbackBind && !isLoopbackPeer(srv.requestIP(req)?.address)) {
        return text("non-loopback peer rejected", 403);
      }

      const url = new URL(req.url);
      const { pathname } = url;

      if (sssfViz.owns(pathname)) return sssfViz.handle(req, url);
      if (workdir.owns(pathname)) return workdir.handle(req, url);

      // Session-scoped routes accept an optional `?session=<name>`; absent → the primary session
      // (identical to pre-multi-session behaviour). The name is only ever a registry Map lookup — it
      // never builds a path. An unknown name is a 404. Global routes below ignore the param entirely.
      const sessionName = url.searchParams.get("session") ?? undefined;
      const unknownSession = () =>
        jsonError(`unknown session: ${sessionName ?? ""}`, 404, req.headers.get("accept-encoding"));

      if (pathname === "/api/snapshot") return snapshotRoute(req, { cfg, registry, activity, snooze, updateMonitor, sssfViz, workdir, journals, transcripts, offerHistory, sessionName });

      // ── Structural creates: new tab / new space (each opens a fresh shell pane) ──
      if (pathname === "/api/tab" && req.method === "POST") {
        const denied = guard(req, cfg, "write");
        if (denied) return denied;
        const rt = registry.get(sessionName);
        if (!rt) return unknownSession();
        return createTab(rt.herdr, rt.engine, req, audit, deviceAuth(req, cfg).device, rt.name);
      }
      if (pathname === "/api/workspace" && req.method === "POST") {
        const denied = guard(req, cfg, "write");
        if (denied) return denied;
        const rt = registry.get(sessionName);
        if (!rt) return unknownSession();
        return createWorkspace(rt.herdr, req, audit, deviceAuth(req, cfg).device, rt.name);
      }

      // ── Tab actions: rename (set its label) / close (kill it + every pane in it) ──
      const tabMatch = pathname.match(TAB_ACTION_ROUTE);
      if (tabMatch && req.method === "POST") {
        const denied = guard(req, cfg, "write");
        if (denied) return denied;
        const rt = registry.get(sessionName);
        if (!rt) return unknownSession();
        const tabId = decodePathSegment(tabMatch[1]!);
        if (tabId === null) return text("bad tab id", 400);
        const action = tabMatch[2];
        const device = deviceAuth(req, cfg).device;
        if (action === "close") return closeTab(rt.herdr, tabId, req, audit, device, rt.name);
        return renameTab(rt.herdr, tabId, req, audit, device, rt.name);
      }

      // ── Space (workspace) actions: rename (set its label). No close — Collie doesn't delete spaces. ──
      const wsMatch = pathname.match(WORKSPACE_ACTION_ROUTE);
      if (wsMatch && req.method === "POST") {
        const denied = guard(req, cfg, "write");
        if (denied) return denied;
        const rt = registry.get(sessionName);
        if (!rt) return unknownSession();
        const workspaceId = decodePathSegment(wsMatch[1]!);
        if (workspaceId === null) return text("bad workspace id", 400);
        return renameWorkspace(rt.herdr, workspaceId, req, audit, deviceAuth(req, cfg).device, rt.name);
      }

      // ── Per-pane read / send ─────────────────────────────────────────────
      const paneMatch = pathname.match(PANE_ROUTE);
      if (paneMatch) {
        const action = paneMatch[2];
        // Reading a pane is allowed for any access-gated client; every action (reply/keys/upload/
        // close) types into or restructures a terminal, so it additionally needs an authorised device.
        // `history` is a READ despite being an action segment — it only ever reads a log off disk.
        const isRead = !action || action === "history";
        const denied = guard(req, cfg, isRead ? "read" : "write");
        if (denied) return denied;
        const paneId = decodePathSegment(paneMatch[1]!);
        if (paneId === null) return text("bad pane id", 400);
        const rt = registry.get(sessionName);
        if (!rt) return unknownSession();
        const { herdr, name: session } = rt;
        // You are in this pane: reading it, replying, sending keys, browsing its history. That is
        // the whole definition of "seen" (.adr/0003), and this is the one place every such request
        // passes through. It cannot false-positive from background polling — the dashboard loader
        // only ever fetches /api/snapshot; paneLoader is the sole reader of pane text — nor from a
        // cross-site request forged at a guessed pane id (see marksPaneSeen).
        //
        // Gated on the request actually being ROUTED below. PANE_ROUTE constrains `action` to the
        // known set, so the only way to reach here unrouted is a method mismatch (a GET at /reply, a
        // POST at /history) — which 405s. Without this a malformed request still marked the pane seen.
        const routed = isRead ? req.method === "GET" : req.method === "POST";
        if (routed && marksPaneSeen(req, action)) activity.noteSeen(session, paneId);
        // Every action is a write; attribute it to the authorised device for the audit trail.
        // `history` is a read, so it gets no device attribution (nothing is written to attribute).
        const device = isRead ? null : deviceAuth(req, cfg).device;

        if (!action && req.method === "GET") return readPane(herdr, cfg, paneId, url, req);
        if (action === "history" && req.method === "GET")
          return paneHistory(cfg, journals, transcripts, rt.engine, herdr, paneId, url, req);
        if (action === "reply" && req.method === "POST") return replyPane(herdr, cfg, paneId, req, audit, device, session);
        if (action === "keys" && req.method === "POST") return keysPane(herdr, cfg, paneId, req, audit, device, session);
        if (action === "upload" && req.method === "POST") return uploadPane(cfg, paneId, req, audit, device, session);
        if (action === "close" && req.method === "POST") return closePane(herdr, paneId, req, audit, device, session);
        if (action === "rename" && req.method === "POST") return renamePane(herdr, paneId, req, audit, device, session);
        return text("method not allowed", 405);
      }

      // ── Misc API ─────────────────────────────────────────────────────────
      if (pathname === "/api/config") return bridgeConfigRoute(req, { cfg, push, operatorCommands, operatorQuickReplies, operatorKeys });
      if (pathname === "/api/subscribe" && req.method === "POST") return subscribeRoute(req, cfg, push);
      if (pathname === "/api/notifications/snooze" && req.method === "POST") return snoozeRoute(req, cfg, snooze, registry, push);
      if (pathname === "/api/notifications/prefs") return notifyPrefsRoute(req, cfg, notifyPrefs, registry);
      if (pathname === "/api/update/check" && req.method === "POST") return updateCheckRoute(req, cfg, updateMonitor);

      // ── Reserved for a fronting proxy's sign-in page ─────────────────────
      // `/auth/` is the one path the service worker always passes to the network (web/src/lib/
      // sw-routes.ts), so it is the only address an installed PWA can reach when a proxy in front of
      // the bridge refuses a stale session. Collie never routes it. If a request gets this far, no
      // proxy claimed it — say so, instead of letting the SPA fallback answer with the app shell and
      // leave the operator staring at the UI they were trying to escape.
      if (isReservedAuthPath(pathname)) return reservedAuthPlaceholder();

      // ── Static PWA (with SPA fallback) ───────────────────────────────────
      return serveStatic(pathname, req.headers.get("host") ?? "", cfg);
    },
  });

  console.log(`[bridge] listening on http://${cfg.host}:${cfg.port}  (poll ${cfg.pollMs}ms)`);
  if (cfg.deviceHeader) {
    console.log(
      `[bridge] per-device auth ON: trusting '${cfg.deviceHeader}', ${cfg.deviceAllowlist.length} device(s) allowlisted`,
    );
  }
  for (const w of startupWarnings(cfg)) console.warn(w);
  // Says so once at boot if the bundle on disk predates its sources — the "my change didn't take"
  // trap for the frontend, where nothing else errors because a stale bundle is still a valid one.
  // Not awaited — startServer is sync by design (its callers use the returned server directly), and
  // a directory walk must never sit between binding the port and returning. The line lands a few ms
  // into the startup block instead of at the end of it.
  void buildFreshness(WEB_ROOT).catch(() => {});

  return server;
}
