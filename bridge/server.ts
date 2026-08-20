import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, normalize, relative, sep } from "node:path";
import type { ActivityLedger } from "./activity.ts";
import type { AuditLog } from "./audit.ts";
import { buildFreshness } from "./build-freshness.ts";
import { isLoopbackBindHost, type Config } from "./config.ts";
import type { HerdrClient, PaneRead } from "./herdr-client.ts";
import { computeEtag, gzipJsonResponse, notModified } from "./http-cache.ts";
import type { NotifyPrefs, NotifyPrefsStore } from "./notify-prefs.ts";
import { createOperatorCommands, createOperatorQuickReplies } from "./operator-commands.ts";
import {
  DEFAULT_PROMPT_TAIL_LINES,
  verifyExpectedPrompt,
  type PromptBindingResult,
} from "./prompt-binding.ts";
import type { Push } from "./push.ts";
import { looksPrivateHost, parsePushSubscription } from "./push-endpoint.ts";
import { herdTagFor, type SessionRegistry } from "./sessions.ts";
import type { Snooze } from "./snooze.ts";
import { createSssfViz } from "./sssf-viz.ts";
import type { UpdateMonitor } from "./update.ts";
import { imageExtFromBytes, makeRoomForUpload, SNIFF_BYTES } from "./uploads.ts";
import type { StateEngine } from "./state-engine.ts";
import { adapterFor, buildJournalRegistry } from "./journal/registry.ts";
import { TranscriptStore } from "./journal/store.ts";
import type { JournalAdapter } from "./journal/types.ts";
import { toPaneWire } from "./types.ts";
import type {
  ActionResponse,
  AgentView,
  BridgeConfig,
  CreateResponse,
  DeviceAuth,
  PaneHistoryResponse,
  PaneReadResponse,
  SnapshotResponse,
  UploadResponse,
} from "./types.ts";

// Image upload limits. Herdr's socket only carries text/keys, so we can't paste an image into the
// terminal — instead we save it to a host file and the client references its path in the message
// (the agent reads images by path). See uploadPane().
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
// Multipart wraps the file in a boundary + part headers, so a legitimately-sized image arrives a
// little over MAX_UPLOAD_BYTES on the wire. Allow a small slack for the Content-Length pre-check.
const MAX_UPLOAD_OVERHEAD = 64 * 1024; // 64 KB
// Hard cap the runtime enforces on ANY request body (Bun.serve maxRequestBodySize). Bigger than the
// upload cap + overhead so the handler's own 413 fires first for honest clients; this cuts off a
// chunked or lying client that never sends an accurate Content-Length.
const MAX_REQUEST_BODY_BYTES = 12 * 1024 * 1024; // 12 MB
// Upper bound on the pane-read `lines` param — don't trust the client (or Herdr) to cap it.
const MAX_READ_LINES = 10_000;
const MAX_EXPECTED_PROMPT_CHARS = 8192;
const PROMPT_BINDING_BLANK_LINE_HEADROOM = 6;

// The built PWA lives in web/dist (Vite output). If it's missing, the bridge still runs the API
// — only the static UI 503s with a hint to build.
const WEB_DIR = join(import.meta.dir, "..", "web", "dist");
// The parent of WEB_DIR — holds both `src/` and `dist/`, which is what the freshness check compares.
const WEB_ROOT = join(import.meta.dir, "..", "web");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Strict CSP. Scripts are external, hashed bundles (script-src 'self'); pane text is rendered by
// React as text nodes, never markup, so terminal output can't inject. 'unsafe-inline' is allowed
// for styles only (the toast library injects a <style> tag) — it can't execute code.
const CSP =
  "default-src 'self'; connect-src 'self'; img-src 'self' data:; " +
  "style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self'; " +
  "manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'";

// Hardening headers set on EVERY response (static + API), applied centrally in the fetch wrapper.
// nosniff stops content-type confusion; no-referrer keeps the tailnet URL out of any Referer.
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// Loopback Host/Origin forms (with an optional port). Loopback is always trusted — only tailscaled
// (or a co-located proxy) can reach the bridge's port, so a loopback caller is the on-host operator.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Whether a TCP peer address is loopback. Unlike the `Host` header — which the client writes and
 * `LOOPBACK_HOST` above merely parses — this comes from the kernel and cannot be forged, so it is
 * the one honest answer to "is this caller on the box".
 *
 * Bun gives IPv4 peers as `127.0.0.1` and IPv6 peers as `::1`; a dual-stack listener can also report
 * an IPv4 peer in v4-mapped form (`::ffff:127.0.0.1`), so all three shapes are matched.
 *
 * A null/absent address is treated as loopback, i.e. this check abstains rather than rejecting.
 * `Server.requestIP` returns null for a request whose socket has already gone, and the bind gate in
 * config.ts is the primary control — this one is defence in depth. Failing closed on an
 * unknowable address would trade a real hole for a flaky one.
 *
 * Pure + exported so the address table is unit-tested without standing up Bun.serve.
 */
export function isLoopbackPeer(address: string | null | undefined): boolean {
  if (!address) return true;
  const a = address.trim().toLowerCase();
  if (a === "::1" || a === "0:0:0:0:0:0:0:1") return true;
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

const PANE_ROUTE = /^\/api\/pane\/([^/]+)(?:\/(reply|keys|upload|close|rename|history))?$/;
// Turns per history page. "Show entire history" means the WHOLE conversation, so the client asks for
// everything and this ceiling is a safety net against a pathological log, not the normal path — a
// 1400-turn session is ~1.4 MB raw / ~400 KB gzipped, which a tailnet link serves fine. The default
// only applies when a caller omits `limit` entirely.
const DEFAULT_HISTORY_LIMIT = 200;
const MAX_HISTORY_LIMIT = 5000;
// A tab supports rename + close — an action group like the pane route. The `/api/tab` POST above
// (create) is an exact match on `/api/tab`, so it never collides with this `/api/tab/<id>/<action>`.
const TAB_ACTION_ROUTE = /^\/api\/tab\/([^/]+)\/(rename|close)$/;
// A workspace supports rename — like the tab route. The `/api/workspace` POST above (create) is an
// exact match on `/api/workspace`, so it never collides with `/api/workspace/<id>/rename`.
const WORKSPACE_ACTION_ROUTE = /^\/api\/workspace\/([^/]+)\/(rename)$/;

/**
 * Header the web app sets on its own pane reads, and the ONLY thing that lets a read mark a pane
 * seen. See {@link marksPaneSeen} for why a header, of all things, is the check.
 */
export const SEEN_HEADER = "x-collie-seen";

/**
 * Whether this request proves it came from Collie's own page, and may therefore stamp the pane as
 * seen (bridge/activity.ts).
 *
 * This exists because marking-seen made a **read-level GET mutate server state**, which it never did
 * before. `checkAccess` deliberately does not demand an `Origin` on reads — browsers omit it on
 * same-origin GETs, so demanding one would reject the real client — and that exemption was safe only
 * while reads had no side effects. Without this check, a page the operator visits while on the
 * tailnet could fire `<img src="https://collie…/api/pane/w1:p1">` at guessable pane ids and silently
 * clear the "Ready · unseen" section: the response is opaque to the attacker, but the write lands,
 * and the operator simply stops being told their agents finished.
 *
 * A custom request header is the check because a no-cors cross-site request **cannot set one** —
 * doing so promotes it to a preflighted CORS request, and the bridge answers no preflight. Our own
 * same-origin `fetch` sets it freely.
 *
 * Write actions (reply/keys/upload/close/rename) need no header: they already cleared
 * `guard(…, "write")`, which requires an `Origin`. `history` is a read despite being an action
 * segment, so it needs the header like any other read.
 */
export function marksPaneSeen(req: Request, action: string | undefined): boolean {
  if (req.headers.get(SEEN_HEADER) !== null) return true;
  return action !== undefined && action !== "history";
}

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

      // Session-scoped routes accept an optional `?session=<name>`; absent → the primary session
      // (identical to pre-multi-session behaviour). The name is only ever a registry Map lookup — it
      // never builds a path. An unknown name is a 404. Global routes below ignore the param entirely.
      const sessionName = url.searchParams.get("session") ?? undefined;
      const unknownSession = () =>
        jsonError(`unknown session: ${sessionName ?? ""}`, 404, req.headers.get("accept-encoding"));

      // ── Live state (polled by the client) ────────────────────────────────
      if (pathname === "/api/snapshot") {
        const gate = checkAccess(req, cfg);
        if (!gate.ok) return text(gate.reason, 403);
        const rt = registry.get(sessionName);
        if (!rt) return unknownSession();
        const { agents, shellPanes, workspaces, tabs, bridge } = rt.engine.current();
        const device = deviceAuth(req, cfg);
        // Attach each pane's activity timestamps. Done here rather than in the state engine so the
        // engine stays a pure Herdr-poller with no knowledge of the ledger — and so the two numbers
        // are read at serialise time, i.e. as fresh as the request.
        const withActivity = (p: AgentView): AgentView => {
          const a = activity.get(rt.name, p.paneId);
          return a ? { ...p, lastActiveAt: a.activeAt, lastSeenAt: a.seenAt } : p;
        };
        // Tag every snapshot poll with the on-disk build id so an open client notices a live rebuild
        // between polls — the no-service-worker self-update path (web/src/lib/self-update.ts).
        return withBuildHeader(
          json({
            bridge,
            // Only report device state when the feature is on, so an off deployment sends nothing new.
            ...(device.enforced ? { device } : {}),
            // The one place a pane leaves the bridge: the session ref is stripped to a presence flag
            // here, so an agent-reported filesystem path never reaches a browser (see toPaneWire).
            // The flag is computed against the registry, so a harness Herdr detects but Collie has no
            // journal for doesn't advertise a History button that can only ever come back empty.
            // withActivity runs FIRST: it returns an AgentView, which is what toPaneWire consumes,
            // and the two timestamps then ride through its rest-spread onto the wire shape.
            // decoratePanes hangs each pane's ADW runs on it (bridge/sssf-viz.ts) — a plain stamp
            // from the last discovery pass, so it costs no I/O here; identity when the feature is off.
            agents: sssfViz.decoratePanes(agents, sessionName).map((p) => toPaneWire(withActivity(p), offerHistory)),
            shellPanes: sssfViz.decoratePanes(shellPanes, sessionName).map((p) => toPaneWire(withActivity(p), offerHistory)),
            // Keyed by the REQUEST's session param (undefined on the primary session), not rt.name:
            // the Traces frame sends the same param back on /sssf/api/*, and the two must match or
            // the primary session's db is never found (404 "no traces", found live 2026-08-18).
            workspaces: sssfViz.decorate(workspaces, [...agents, ...shellPanes], sessionName),
            tabs,
            sessions: registry.list(),
            notifications: { snoozedUntil: snooze.until() },
            update: updateMonitor.status(),
            ts: Date.now(),
          } satisfies SnapshotResponse, req.headers.get("accept-encoding")),
          await buildId(),
        );
      }

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
          return paneHistory(cfg, journals, transcripts, rt.engine, paneId, url, req);
        if (action === "reply" && req.method === "POST") return replyPane(herdr, cfg, paneId, req, audit, device, session);
        if (action === "keys" && req.method === "POST") return keysPane(herdr, cfg, paneId, req, audit, device, session);
        if (action === "upload" && req.method === "POST") return uploadPane(cfg, paneId, req, audit, device, session);
        if (action === "close" && req.method === "POST") return closePane(herdr, paneId, req, audit, device, session);
        if (action === "rename" && req.method === "POST") return renamePane(herdr, paneId, req, audit, device, session);
        return text("method not allowed", 405);
      }

      // ── Misc API ─────────────────────────────────────────────────────────
      if (pathname === "/api/config") {
        // Read-level, like the other non-terminal endpoints. Nothing Collie puts here is a
        // credential — the VAPID public key is handed to every browser by design — but the payload
        // is no longer entirely Collie's: operatorCommands is operator-authored text, and any read
        // client sees it verbatim (`.env.example` says so where it is set).
        // It was also the one route that skipped checkAccess entirely, so COLLIE_PUBLIC_HOSTS
        // didn't cover it and a rebound DNS name could read it. The client only ever calls this
        // same-origin, and a refusal can't be mistaken for an outage: ConnectionBanner
        // short-circuits to AuthErrorBanner before its red-state probe runs. Noted in #32.
        const denied = guard(req, cfg, "read");
        if (denied) return denied;
        // Re-read per request behind an mtime check, like buildId() — editing commands.toml is live,
        // with no restart. The path is cfg's, never the request's.
        const mine = await operatorCommands();
        const quick = await operatorQuickReplies();
        return json({
          push: push.enabled,
          vapidPublicKey: push.publicKey,
          build: await buildId(),
          // Only when true, so the common (healthy) payload is byte-identical to before.
          ...((await buildFreshness(WEB_ROOT)).stale ? { staleBuild: true as const } : {}),
          // Omitted entirely when there are none, so an operator who never wrote a commands.toml
          // ships the same payload as before.
          ...(mine.length > 0 ? { operatorCommands: mine } : {}),
          ...(quick.length > 0 ? { operatorQuickReplies: quick } : {}),
        } satisfies BridgeConfig, req.headers.get("accept-encoding"));
      }
      if (pathname === "/api/subscribe" && req.method === "POST") {
        // Write-level: a subscription is a standing grant to receive every alert this bridge sends,
        // so an unallowlisted device must not be able to create one for itself (issue #8). It isn't
        // terminal-driving, but "read-only" has never meant "may register for the operator's push
        // stream" — see .adr/0021 (which supersedes 0020).
        const denied = guard(req, cfg, "write");
        if (denied) return denied;
        const bad = requireJsonBody(req);
        if (bad) return bad;
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return text("bad subscription", 400);
        }
        // Validate endpoint against allowed push hosts, validate key lengths, and strip unknown
        // properties before passing to storage (issue #7).
        const parsed = parsePushSubscription(body, cfg.pushAllowedHosts);
        if (parsed === null) return text("bad subscription", 400);
        const result = await push.addSubscription(parsed, {
          replaces: supersededEndpoint(body),
          userAgent: req.headers.get("user-agent") ?? undefined,
        });
        if (result === "full") return text("too many subscriptions", 429);
        return secure(new Response(null, { status: 204 }));
      }
      if (pathname === "/api/notifications/snooze" && req.method === "POST") {
        // Write-level: snooze is BRIDGE-WIDE (.adr/0003), so one read-only device muting itself
        // mutes the operator's phone too. Silencing every alert is damage, which is exactly what the
        // device gate bounds (issue #8).
        const denied = guard(req, cfg, "write");
        if (denied) return denied;
        const bad = requireJsonBody(req);
        if (bad) return bad;
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return text("bad request", 400);
        }
        const until = (body as { snoozedUntil?: unknown }).snoozedUntil;
        // Reject NaN/Infinity here so a nonsense deadline is a 400, not a silent clamp.
        if (until !== null && (typeof until !== "number" || !Number.isFinite(until)))
          return text("bad snoozedUntil", 400);
        await snooze.set(until);
        // Snoozing should also clear whatever's already on the lock screen — across every session,
        // since snooze is bridge-wide. Each session owns its own notification slot (tag).
        if (snooze.isMuted()) {
          for (const rt of registry.all()) {
            void push.send({ type: "clear", tag: herdTagFor(rt.isPrimary, rt.name) });
          }
        }
        return json({ snoozedUntil: snooze.until() }, req.headers.get("accept-encoding"));
      }
      if (pathname === "/api/notifications/prefs") {
        // Which agent statuses push, bridge-wide. Reading them discloses nothing and changes
        // nothing, so GET stays read-level; POST is a write, like snooze — {"blocked":false,
        // "done":false,"updates":false} silences every alert for every device (issue #8).
        if (req.method === "GET") {
          const denied = guard(req, cfg, "read");
          if (denied) return denied;
          return json(notifyPrefs.current(), req.headers.get("accept-encoding"));
        }
        if (req.method === "POST") {
          const denied = guard(req, cfg, "write");
          if (denied) return denied;
          const bad = requireJsonBody(req);
          if (bad) return bad;
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return text("bad request", 400);
          }
          const patch = parseNotifyPrefsPatch(body);
          if (!patch) return text("bad prefs", 400);
          const updated = await notifyPrefs.set(patch);
          // Prefs may have just disabled a kind — retract any pending/outstanding alerts of it, in
          // every live session (prefs are bridge-wide; each session has its own coordinator).
          for (const rt of registry.all()) rt.notifications.applyPrefs();
          return json(updated, req.headers.get("accept-encoding"));
        }
        return text("method not allowed", 405);
      }
      if (pathname === "/api/update/check" && req.method === "POST") {
        // Force an immediate upstream check (the "check for updates" button) instead of waiting for
        // the periodic timer. Still read-level — a version check isn't operator-visible state — but
        // the monitor now enforces a minimum interval between upstream fetches (update.ts), because
        // the in-flight guard only coalesces CONCURRENT calls: a sequential loop was one anonymous
        // GitHub request each, against a 60/hr limit (issue #8). A throttled call is a no-op that
        // returns the last known status.
        const denied = guard(req, cfg, "read");
        if (denied) return denied;
        await updateMonitor.checkRelease();
        return json(updateMonitor.status(), req.headers.get("accept-encoding"));
      }

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

/**
 * The security-posture warnings emitted once at startup, as plain strings (each already prefixed
 * `[bridge] WARNING:`). Pure + exported so the exact set that fires for a given {@link Config} is
 * unit-testable without standing up Bun.serve; the bootstrap in {@link startServer} just logs each
 * via `console.warn`. The identity-gate advice forks on {@link Config.skipServe}: behind a reverse
 * proxy the `Tailscale-User-Login` header is never injected, so trustedUser is inert (nag toward
 * COLLIE_DEVICE_HEADER instead), whereas under `tailscale serve` an empty trustedUser is the open
 * door Variant A closes.
 */
export function startupWarnings(cfg: Config): string[] {
  const warnings: string[] = [];
  if (!isLoopbackBindHost(cfg.host)) {
    warnings.push(
      `[bridge] WARNING: bound to ${cfg.host} via COLLIE_ALLOW_NON_LOOPBACK_BIND — the identity, device and same-origin gates are all client-settable on a wide bind, and the peer-address check is off. Whatever fronts this port is now the only control.`,
    );
  }
  if (cfg.deviceHeader && cfg.deviceAllowlist.length === 0) {
    warnings.push(
      `[bridge] WARNING: COLLIE_DEVICE_HEADER set but COLLIE_DEVICE_ALLOWLIST is empty — every device is read-only`,
    );
  }
  if (cfg.skipServe) {
    // Reverse-proxy mode: no tailscale serve injects Tailscale-User-Login, so checkAccess never has
    // an identity to enforce — trustedUser is dead config. Only nag when it's set (a likely mistake).
    if (cfg.trustedUser) {
      warnings.push(
        `[bridge] WARNING: COLLIE_TRUSTED_USER has no effect under COLLIE_SKIP_SERVE=1 — without tailscale serve in front, the Tailscale-User-Login header is never injected. Use COLLIE_DEVICE_HEADER for per-device auth (see DEPLOYMENT.md → Variant C).`,
      );
    }
  } else if (!cfg.trustedUser) {
    warnings.push(
      `[bridge] WARNING: COLLIE_TRUSTED_USER is empty — any tailnet device/user that reaches the bridge gets full write access. Set it to your tailnet login (see README → Variant A).`,
    );
  } else if (cfg.trustedUserOptional) {
    warnings.push(
      `[bridge] WARNING: COLLIE_TRUSTED_USER_OPTIONAL=1 — a request with no Tailscale-User-Login is accepted, so any TAGGED tailnet node (which serve injects no identity for) gets full write access. Unset it outside host-local development.`,
    );
  }
  if (cfg.allowAnyHost) {
    warnings.push(
      `[bridge] WARNING: COLLIE_ALLOW_ANY_HOST=1 — Host-header validation is OFF, so a DNS-rebound page can reach this bridge as if it were same-origin. Unset it and set COLLIE_PUBLIC_HOSTS to the host(s) you serve on.`,
    );
  } else if (
    cfg.publicHosts.length === 0 &&
    cfg.tailscaleHosts.length === 0 &&
    cfg.allowedOrigins.length === 0
  ) {
    warnings.push(
      `[bridge] WARNING: no non-loopback Host is allowed — every request except one addressed to localhost/127.0.0.1 will be rejected with "host not allowed". Set COLLIE_PUBLIC_HOSTS to the exact host(s) you serve on (required behind your own reverse proxy, see README → Variant C/E).`,
    );
  }
  const risky = cfg.pushAllowedHosts.filter(looksPrivateHost);
  if (risky.length) {
    warnings.push(
      `[bridge] WARNING: COLLIE_PUSH_ALLOWED_HOSTS contains private/loopback host(s) (${risky.join(", ")}) — any read-level client can now make the bridge POST to them (issue #7)`,
    );
  }
  return warnings;
}

async function readPane(
  herdr: HerdrClient,
  cfg: Config,
  paneId: string,
  url: URL,
  req: Request,
): Promise<Response> {
  const linesParam = Number.parseInt(url.searchParams.get("lines") ?? "", 10);
  // Clamp to a sane ceiling — don't trust the client (or Herdr) to bound an enormous read.
  const lines =
    Number.isFinite(linesParam) && linesParam > 0
      ? Math.min(linesParam, MAX_READ_LINES)
      : cfg.readLines;
  try {
    // "ansi" so the client can render a faithful, colored terminal mirror. It is also, as far as we
    // have probed, why this read leaves the operator's terminal alone: a `recent` read only harvests
    // an alt-screen pane — scrolling it up and back — in `text` format. `lines` here is whatever the
    // web app asked for (600 for the history view), well past any pane's height, so switching this
    // to "text" would move someone's screen on every revalidate. See HERDR_API.md → `pane.read`.
    const read = await herdr.readPane(paneId, "recent", lines, "ansi");
    const data = paneReadResponse(paneId, read);
    // ETag is derived from the serialised body — if content hasn't changed the client gets a 304
    // and skips the whole transfer (the big win on a cellular link).
    const bodyStr = JSON.stringify(data);
    const etag = computeEtag(bodyStr);
    // Tag pane polls too (both the 304 and the full body), so a client that only has a pane open —
    // not the home snapshot — still observes a live rebuild between polls.
    const build = await buildId();
    if (notModified(req.headers.get("if-none-match"), etag)) {
      // RFC 7232 §4.1: 304 MUST echo the ETag; body MUST be empty.
      return withBuildHeader(
        secure(
          new Response(null, {
            status: 304,
            headers: { etag, "cache-control": "no-store" },
          }),
        ),
        build,
      );
    }
    return withBuildHeader(
      secure(gzipJsonResponse(data, req.headers.get("accept-encoding"), { etag })),
      build,
    );
  } catch (err) {
    return text(failureText("herdr read", err), 502);
  }
}

/**
 * Map a Herdr pane read to the REST response body. Pure + exported so the `revision` passthrough
 * (the client's prompt-select race guard depends on it) is covered by the bridge unit tests without
 * standing up Bun.serve / the socket client.
 */
export function paneReadResponse(paneId: string, read: PaneRead): PaneReadResponse {
  return { paneId, text: read.text, truncated: read.truncated, revision: read.revision };
}

/**
 * Parse the history page params. Pure + exported so the clamping is unit-tested without Bun.serve.
 * `before` is an opaque cursor (a turn's uuid) that only ever reaches an in-memory `findIndex`, so it
 * needs no validation beyond length — it never touches the filesystem.
 */
export function historyParams(url: URL): { limit: number; before?: string } {
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_HISTORY_LIMIT) : DEFAULT_HISTORY_LIMIT;
  const before = url.searchParams.get("before");
  return { limit, ...(before && before.length <= 100 ? { before } : {}) };
}

/**
 * GET /api/pane/:id/history — the conversation history the pane's terminal cannot provide.
 *
 * The session ref is resolved HERE, from the live snapshot, keyed by pane id — the client never sends
 * one. That is the whole safety story for a route that reads files: the only client-controlled inputs
 * are a pane id (a Map lookup) and an opaque cursor (an array lookup). Which harness knows how to
 * read the log is the registry's decision, so this route stays agent-agnostic.
 */
async function paneHistory(
  cfg: Config,
  journals: Record<string, JournalAdapter> | null,
  transcripts: TranscriptStore | null,
  engine: StateEngine,
  paneId: string,
  url: URL,
  req: Request,
): Promise<Response> {
  const accept = req.headers.get("accept-encoding");
  const unavailable = (reason: "disabled" | "no-session" | "no-log") =>
    json({ paneId, available: false, reason } satisfies PaneHistoryResponse, accept);

  if (!cfg.transcript || transcripts === null || journals === null) return unavailable("disabled");

  const { agents, shellPanes } = engine.current();
  const pane = [...agents, ...shellPanes].find((a) => a.paneId === paneId);
  // No pane, or an agent that named no session (a shell, or a harness whose integration isn't
  // installed): nothing to read, and that's an ordinary answer rather than an error.
  if (!pane) return unavailable("no-session");
  // An agent with no adapter has no journal. Same answer — the UI shouldn't distinguish "this
  // harness isn't supported" from "this pane never started one"; both mean there's nothing to show.
  const adapter = adapterFor(journals, pane.agent);
  if (adapter === undefined) return unavailable("no-session");
  // Herdr has no grok integration, so a grok pane arrives with no session ref. Infer from cwd.
  const session =
    pane.agentSession ??
    (adapter.inferFromCwd !== undefined && pane.cwd ? await adapter.inferFromCwd(pane.cwd) : null);
  if (!session) return unavailable("no-session");

  try {
    const page = await transcripts.page(adapter, session, historyParams(url));
    if (page === null) return unavailable("no-log");
    return json({ paneId, available: true, ...page } satisfies PaneHistoryResponse, accept);
  } catch (err) {
    return text(failureText("transcript read", err), 502);
  }
}

/** Just the two one-shot RPCs a reply needs — real HerdrClient in the bridge, fake in tests. */
export interface ReplySender {
  sendPaneText(paneId: string, text: string): Promise<void>;
  sendPaneKeys(paneId: string, keys: string[]): Promise<void>;
}

/** Outcome of the two-step send. `textDelivered` is only meaningful on the failure branch. */
export type ReplyOutcome =
  | { ok: true; textDelivered: boolean }
  | { ok: false; error: string; textDelivered: boolean };

/**
 * The reply's two one-shot RPCs — type the text, then send the submit key(s) — as a pure function so
 * the partial-failure branch is unit-testable with a fake client. The important case: if the text
 * lands but the submit keypress fails, we surface a distinct, actionable error and `textDelivered:
 * true` so the client knows NOT to resend (which would duplicate the already-typed text). Pure +
 * exported.
 */
export type SleepFn = (ms: number) => Promise<void>;
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Pause between typing and Enter so the TUI accepts the submit key (preview-action polls ~350ms). */
const REPLY_SETTLE_MS = 350;

export async function sendReplySteps(
  client: ReplySender,
  paneId: string,
  txt: string,
  submit: boolean,
  submitKeys: string[],
  sleep: SleepFn = defaultSleep,
): Promise<ReplyOutcome> {
  let textDelivered = false;
  try {
    if (txt) {
      await client.sendPaneText(paneId, txt);
      textDelivered = true;
    }
    if (submit) {
      if (txt) await sleep(REPLY_SETTLE_MS);
      await client.sendPaneKeys(paneId, submitKeys);
    }
    return { ok: true, textDelivered };
  } catch (err) {
    if (textDelivered && submit) {
      // Text is already in the pane — only the submit failed. Tell the operator to check/submit it
      // by hand rather than resend, and flag textDelivered so a resend-on-error UI can hold off.
      return {
        ok: false,
        textDelivered: true,
        error: "typed into the pane but not submitted — check the pane before resending",
      };
    }
    return { ok: false, textDelivered, error: failureText("reply", err) };
  }
}

export async function replyPane(
  herdr: HerdrClient,
  cfg: Config,
  paneId: string,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const bad = requireJsonBody(req);
  if (bad) return bad;
  let body: { text?: string; submit?: boolean; expected_prompt?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return text("bad body", 400);
  }
  const expected = expectedPrompt(body);
  if (!expected.ok) return text("bad expected_prompt", 400);
  const txt = body.text ?? "";
  const submit = body.submit ?? true;
  const ae = req.headers.get("accept-encoding");
  const binding = expected.present
    ? await checkPromptBinding(herdr, cfg, paneId, expected.value)
    : null;
  if (binding && !binding.ok) {
    audit.record({
      action: "reply",
      paneId,
      session,
      device,
      detail: {
        text: txt,
        submit,
        submitted: false,
        textDelivered: false,
        promptBinding: binding.audit,
      },
    });
    return promptBindingFailure(binding, ae);
  }
  const outcome = await sendReplySteps(herdr, paneId, txt, submit, cfg.submitKeys);
  // Audit the attempt regardless of outcome — text may have landed even when the submit failed.
  audit.record({
    action: "reply",
    paneId,
    session,
    device,
    detail: {
      text: txt,
      submit,
      submitted: outcome.ok,
      textDelivered: outcome.textDelivered,
      ...(binding ? { promptBinding: binding.audit } : {}),
    },
  });
  if (outcome.ok) return json({ ok: true } satisfies ActionResponse, ae);
  return json(
    { ok: false, error: outcome.error, textDelivered: outcome.textDelivered } satisfies ActionResponse,
    ae,
  );
}

export async function keysPane(
  herdr: HerdrClient,
  cfg: Config,
  paneId: string,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const bad = requireJsonBody(req);
  if (bad) return bad;
  let body: { keys?: unknown; expected_prompt?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return text("bad body", 400);
  }
  const expected = expectedPrompt(body);
  if (!expected.ok) return text("bad expected_prompt", 400);
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string") : [];
  if (keys.length === 0) return text("no keys", 400);
  const ae = req.headers.get("accept-encoding");
  const binding = expected.present
    ? await checkPromptBinding(herdr, cfg, paneId, expected.value)
    : null;
  if (binding && !binding.ok) {
    audit.record({
      action: "keys",
      paneId,
      session,
      device,
      detail: { keys, promptBinding: binding.audit },
    });
    return promptBindingFailure(binding, ae);
  }
  try {
    await herdr.sendPaneKeys(paneId, keys);
    audit.record({
      action: "keys",
      paneId,
      session,
      device,
      detail: { keys, ...(binding ? { promptBinding: binding.audit } : {}) },
    });
    return json({ ok: true } satisfies ActionResponse, ae);
  } catch (err) {
    if (binding) {
      audit.record({
        action: "keys",
        paneId,
        session,
        device,
        detail: { keys, sent: false, promptBinding: binding.audit },
      });
    }
    return json({ ok: false, error: failureText("key send", err) } satisfies ActionResponse, ae);
  }
}

type ExpectedPrompt =
  | { ok: true; present: false }
  | { ok: true; present: true; value: string }
  | { ok: false };

function expectedPrompt(body: object): ExpectedPrompt {
  if (!Object.prototype.hasOwnProperty.call(body, "expected_prompt")) {
    return { ok: true, present: false };
  }
  const value = (body as { expected_prompt?: unknown }).expected_prompt;
  if (typeof value !== "string" || value.length > MAX_EXPECTED_PROMPT_CHARS) {
    return { ok: false };
  }
  return { ok: true, present: true, value };
}

type PromptBindingCheck =
  | {
      ok: true;
      audit: { checked: true; passed: true; expected: string };
    }
  | {
      ok: false;
      error: string;
      status: 409 | 502;
      code?: "prompt_changed";
      audit: {
        checked: true;
        passed: false;
        expected: string;
        reason: Extract<PromptBindingResult, { ok: false }>["reason"] | "read_failed";
      };
    };

// There is deliberately no expected_blocked flag. agent_status is not carried by pane.read, only by
// session.snapshot, so checking it would cost a second RPC before the write and widen the very
// window this feature exists to shrink. The region check already subsumes it: if the exact prompt
// text is still on screen, that prompt is still what the pane is showing.
async function checkPromptBinding(
  herdr: HerdrClient,
  cfg: Config,
  paneId: string,
  expected: string,
): Promise<PromptBindingCheck> {
  let fresh: PaneRead;
  try {
    const expectedRawLines = expected.split(/\r\n?|\n/).length;
    const bindingReadLines = Math.min(
      MAX_READ_LINES,
      Math.max(
        cfg.readLines,
        expectedRawLines + DEFAULT_PROMPT_TAIL_LINES + PROMPT_BINDING_BLANK_LINE_HEADROOM,
      ),
    );
    // Keep this coupled to readPane(): use its recent source and ANSI format so the bridge verifies
    // the same kind of pane data the GET handler serves. The line count deliberately does not follow
    // cfg.readLines alone because a small legal setting may not contain the expected region; include
    // room for the accepted tail and for blank separator lines that normalization drops.
    fresh = await herdr.readPane(paneId, "recent", bindingReadLines, "ansi");
  } catch (err) {
    return {
      ok: false,
      error: failureText("herdr read", err),
      status: 502,
      audit: { checked: true, passed: false, expected, reason: "read_failed" },
    };
  }

  const result = verifyExpectedPrompt(fresh.text, expected);
  if (!result.ok) {
    return {
      ok: false,
      error: "prompt changed",
      status: 409,
      code: "prompt_changed",
      audit: { checked: true, passed: false, expected, reason: result.reason },
    };
  }

  // This is a mitigation, not a guarantee. The re-read and the send_keys are two separate herdr
  // RPCs, so a TOCTOU window remains by construction; it shrinks from seconds (poll interval + push
  // latency + human reaction time) to the few milliseconds between two local RPCs. It removes the
  // human-latency portion of the window, which is where essentially all of the real risk lives.
  // Closing the window completely would need a conditional-input primitive in herdr (send_keys with
  // a precondition rejected atomically server-side), which does not exist today.
  return { ok: true, audit: { checked: true, passed: true, expected } };
}

function promptBindingFailure(
  result: Extract<PromptBindingCheck, { ok: false }>,
  acceptEncoding: string | null,
): Response {
  return json(
    {
      ok: false,
      error: result.error,
      ...(result.code ? { code: result.code } : {}),
    } satisfies ActionResponse,
    acceptEncoding,
    result.status,
  );
}

// Close a pane ("kill the agent"). Structural op — strictly less powerful than the text/keys
// injection the bridge already allows, so it stays within the existing remote-shell threat model.
async function closePane(
  herdr: HerdrClient,
  paneId: string,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const ae = req.headers.get("accept-encoding");
  try {
    await herdr.closePane(paneId);
    audit.record({ action: "pane.close", paneId, session, device, detail: {} });
    return json({ ok: true } satisfies ActionResponse, ae);
  } catch (err) {
    return json({ ok: false, error: failureText("close pane", err) } satisfies ActionResponse, ae);
  }
}

// Set or clear a pane's label. Structural metadata op — strictly less powerful than the text/keys
// injection the bridge already allows, so it stays within the existing remote-shell threat model.
// The body's `label` must be a string or null; a blank string clears (so a user can wipe a label by
// saving an empty field), which we send to Herdr as `label: null`.
async function renamePane(
  herdr: HerdrClient,
  paneId: string,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const bad = requireJsonBody(req);
  if (bad) return bad;
  const ae = req.headers.get("accept-encoding");
  let body: { label?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return text("bad body", 400);
  }
  if (body.label !== null && typeof body.label !== "string") return text("bad label", 400);
  const trimmed = typeof body.label === "string" ? body.label.trim() : "";
  const label = trimmed.length > 0 ? trimmed : null;
  try {
    await herdr.renamePane(paneId, label);
    audit.record({ action: "pane.rename", paneId, session, device, detail: { label } });
    return json({ ok: true } satisfies ActionResponse, ae);
  } catch (err) {
    return json({ ok: false, error: failureText("rename pane", err) } satisfies ActionResponse, ae);
  }
}

/**
 * Validate an untrusted tab or workspace rename body's `label`. Both tab and workspace labels are
 * NON-null, NON-empty strings (only pane.rename has a clear, via null). Collie has no "clear" for a
 * tab or workspace and rejects a blank label.
 * Pure + exported so the rule is unit-testable without standing up Bun.serve.
 */
export function normalizeLabel(
  v: unknown,
): { ok: true; label: string } | { ok: false; error: string } {
  if (typeof v !== "string") return { ok: false, error: "bad label" };
  const label = v.trim();
  if (!label) return { ok: false, error: "label required" };
  return { ok: true, label };
}

// Set a tab's label. Structural metadata op — strictly less powerful than the text/keys injection the
// bridge already allows, so it stays within the existing remote-shell threat model. A tab has no
// "clear" (see normalizeLabel): a blank label is a 400, not a reset to the tab number.
async function renameTab(
  herdr: HerdrClient,
  tabId: string,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const bad = requireJsonBody(req);
  if (bad) return bad;
  const ae = req.headers.get("accept-encoding");
  let body: { label?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return text("bad body", 400);
  }
  const parsed = normalizeLabel(body.label);
  if (!parsed.ok) return text(parsed.error, 400);
  try {
    await herdr.renameTab(tabId, parsed.label);
    audit.record({ action: "tab.rename", session, device, detail: { tabId, label: parsed.label } });
    return json({ ok: true } satisfies ActionResponse, ae);
  } catch (err) {
    return json({ ok: false, error: failureText("rename tab", err) } satisfies ActionResponse, ae);
  }
}

// Set a workspace's label. Structural metadata op — same threat model as tab.rename, so the same
// write guard. A workspace has no "clear" (see normalizeLabel): a blank label is a 400.
async function renameWorkspace(
  herdr: HerdrClient,
  workspaceId: string,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const bad = requireJsonBody(req);
  if (bad) return bad;
  const ae = req.headers.get("accept-encoding");
  let body: { label?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return text("bad body", 400);
  }
  const parsed = normalizeLabel(body.label);
  if (!parsed.ok) return text(parsed.error, 400);
  try {
    await herdr.renameWorkspace(workspaceId, parsed.label);
    audit.record({
      action: "workspace.rename",
      session,
      device,
      detail: { workspaceId, label: parsed.label },
    });
    return json({ ok: true } satisfies ActionResponse, ae);
  } catch (err) {
    return json({ ok: false, error: failureText("rename space", err) } satisfies ActionResponse, ae);
  }
}

// Close a tab, killing every pane inside it (live-verified 2026-07-19: the tab's panes disappear with
// it — see HERDR_API.md). Structural op — no more powerful than closing those panes one-by-one, which
// the bridge already allows via pane.close — so it stays within the existing remote-shell threat
// model. No body: the tab id is in the path.
async function closeTab(
  herdr: HerdrClient,
  tabId: string,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const ae = req.headers.get("accept-encoding");
  try {
    await herdr.closeTab(tabId);
    audit.record({ action: "tab.close", session, device, detail: { tabId } });
    return json({ ok: true } satisfies ActionResponse, ae);
  } catch (err) {
    return json({ ok: false, error: failureText("close tab", err) } satisfies ActionResponse, ae);
  }
}

// Create a new tab in a workspace, opening a fresh shell pane (you then launch your own agent in
// it). Structural — no more privilege than typing into an existing pane (you can already spawn a
// shell that way). `cwd` omitted => inherits the workspace dir. session.* stays unexposed.
async function createTab(
  herdr: HerdrClient,
  engine: StateEngine,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const bad = requireJsonBody(req);
  if (bad) return bad;
  let body: { workspaceId?: string; label?: string; cwd?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return text("bad body", 400);
  }
  const workspaceId = body.workspaceId?.trim();
  const ae = req.headers.get("accept-encoding");
  if (!workspaceId) return json({ ok: false, error: "workspaceId required" } satisfies CreateResponse, ae);
  try {
    const created = await herdr.createTab(workspaceId, { label: body.label, cwd: body.cwd });
    const label =
      engine.current().workspaces.find((w) => w.workspaceId === created.workspaceId)?.label ??
      created.workspaceId;
    audit.record({
      action: "tab.create",
      paneId: created.paneId,
      session,
      device,
      detail: { workspaceId, label: body.label, cwd: body.cwd },
    });
    return json({
      ok: true,
      pane: { ...created, workspaceLabel: label },
    } satisfies CreateResponse, ae);
  } catch (err) {
    return json({ ok: false, error: failureText("create tab", err) } satisfies CreateResponse, ae);
  }
}

// Create a new workspace ("space") with a fresh shell pane. `cwd` defaults to the user's home dir
// when the client doesn't specify one (typing a path on a phone is painful) — it's a shell, so you
// can cd from there. Same structural-only threat model as createTab.
async function createWorkspace(
  herdr: HerdrClient,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const bad = requireJsonBody(req);
  if (bad) return bad;
  let body: { cwd?: string; label?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return text("bad body", 400);
  }
  const cwd = body.cwd?.trim() || homedir();
  const ae = req.headers.get("accept-encoding");
  try {
    const created = await herdr.createWorkspace({ cwd, label: body.label });
    audit.record({
      action: "workspace.create",
      paneId: created.paneId,
      session,
      device,
      detail: { label: body.label, cwd },
    });
    return json({
      ok: true,
      pane: {
        paneId: created.paneId,
        workspaceId: created.workspaceId,
        workspaceLabel: created.workspaceLabel ?? created.workspaceId,
        tabId: created.tabId,
        cwd: created.cwd,
      },
    } satisfies CreateResponse, ae);
  } catch (err) {
    return json({ ok: false, error: failureText("create space", err) } satisfies CreateResponse, ae);
  }
}

// Save an uploaded image to a host file and return its absolute path. The client then references
// that path in a message; Claude Code / Codex read images by path (the terminal can't take a
// pasted image over the socket). Validated by SIZE and by its MAGIC BYTES — never by the declared
// Content-Type, which the client writes (issue #9). The filename is server-generated.
async function uploadPane(
  cfg: Config,
  paneId: string,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
): Promise<Response> {
  const ae = req.headers.get("accept-encoding");
  // Reject an oversize upload by its declared Content-Length BEFORE buffering — req.formData()
  // reads the whole body into memory first, so a 100 MB "image" would be materialised just to fail
  // the size check below. Multipart adds a boundary + part headers, so allow a small slack.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + MAX_UPLOAD_OVERHEAD) {
    return secure(
      new Response(
        JSON.stringify({
          ok: false,
          error: "image too large (max 10 MB)",
        } satisfies UploadResponse),
        { status: 413, headers: { "content-type": "application/json; charset=utf-8" } },
      ),
    );
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return text("expected multipart form data", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ ok: false, error: "no file" } satisfies UploadResponse, ae);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ ok: false, error: "image too large (max 10 MB)" } satisfies UploadResponse, ae);
  }
  try {
    // formData() has already buffered the body, so this is a copy, not a second read. Take it once
    // and use it for both the sniff and the write.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = imageExtFromBytes(bytes.subarray(0, SNIFF_BYTES));
    if (!ext) {
      // Deliberately does not echo file.type back: it is client-controlled and, now that the bytes
      // decide, it is not the reason for the refusal either.
      return json(
        { ok: false, error: "unsupported image type (expected PNG, JPEG, GIF or WebP)" } satisfies UploadResponse,
        ae,
      );
    }
    const dir = join(cfg.stateDir, "uploads");
    // 0700 — uploads (and the state dir they live under) may hold sensitive images; keep them
    // owner-only. recursive:true applies the mode to any intermediate dirs it creates too.
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // ...but mkdir applies `mode` only to dirs it CREATES, so a dir left over from an earlier build
    // (or from a COLLIE_STATE_DIR pointing at something shared) keeps its old perms. Re-assert it.
    // Best-effort: if we don't own the dir we still write the file at 0600 below, which is the
    // protection that actually matters. cfg.stateDir itself is left alone on purpose — the operator
    // chose that path and may share it deliberately.
    await chmod(dir, 0o700).catch(() => {});
    // Bound the directory's total size, evicting oldest-first (issue #9).
    if (!(await makeRoomForUpload(dir, file.size))) {
      return json({ ok: false, error: "upload storage full" } satisfies UploadResponse, ae);
    }
    const safePane = paneId.replace(/[^A-Za-z0-9_-]/g, "_");
    const filename = `${safePane}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const fullPath = join(dir, filename);
    // node:fs write (not Bun.write, which has no mode option) so the file is owner-only from the
    // moment it exists — a chmod after the fact leaves a window where it is world-readable at the
    // process umask. The name is a fresh UUID, so O_CREAT always applies the mode.
    await writeFile(fullPath, bytes, { mode: 0o600 });
    audit.record({
      action: "upload",
      paneId,
      session,
      device,
      detail: { filename: file.name, size: file.size, saved: filename },
    });
    return json({ ok: true, path: fullPath } satisfies UploadResponse, ae);
  } catch (err) {
    return json({ ok: false, error: failureText("upload", err) } satisfies UploadResponse, ae);
  }
}

/**
 * Whether this request's method can change state — anything that is not a safe read.
 *
 * The Origin requirement keys off this as well as the access level, because the two are different
 * questions: `level` is what the caller is permitted to do, while the method is whether this
 * particular call mutates. A read-level POST (issue #8 — snooze, prefs, subscribe, update/check)
 * was accepted with no Origin at all from a remote Host, which is exactly the non-browser /
 * Origin-stripped shape the write rule exists to refuse. Browsers always send Origin on a POST.
 *
 * `req.method` is read defensively: the gate unit tests hand `checkAccess` a headers-only stub, so
 * an absent method reads as GET.
 */
export function isStateChangingMethod(req: Request): boolean {
  const method = (req.method ?? "GET").toUpperCase();
  return method !== "GET" && method !== "HEAD";
}

/**
 * Access gate for the API:
 *  - Host allowlist (fail-closed): the request's Host header must be a loopback form, an explicit
 *    COLLIE_PUBLIC_HOSTS entry, a ctl-discovered Tailscale host (COLLIE_TAILSCALE_HOSTS), or the
 *    host of an allowed origin — otherwise rejected, BEFORE any Origin logic (fail-closed). This
 *    defeats DNS rebinding (issue #3), where a browser is tricked into sending Host==Origin==evil.example
 *    so a bare same-origin check trivially passes. COLLIE_ALLOW_ANY_HOST=1 is the explicit opt-out.
 *  - Same-origin only: the Origin host must equal the Host header, or the exact Origin must be
 *    listed in COLLIE_ALLOWED_ORIGINS. A loopback Origin gets no special pass — a page on
 *    http://localhost:<any port> is a different origin from a remote Collie, and treating it as
 *    trusted handed any local page a CSRF write against the bridge. Browsers omit Origin on
 *    same-origin GETs (so the snapshot poll passes); they send it on POSTs.
 *  - Origin required for anything state-changing: a request with no Origin is trusted only from
 *    loopback (curl on the host) if it is a write OR its method is not GET/HEAD. Browsers always
 *    send Origin on fetch/SW POSTs, so a missing Origin on a remote POST is a non-browser or
 *    Origin-stripped request — reject it whatever access level the route asks for (issue #8).
 *  - Optional Tailscale identity: when a trusted user is configured under `tailscale serve`, the
 *    request must carry a matching `Tailscale-User-Login`. A missing header is rejected too —
 *    serve injects none for tagged nodes, so tolerating it let any tagged node write. Under
 *    COLLIE_SKIP_SERVE=1 (no injector) or COLLIE_TRUSTED_USER_OPTIONAL=1, only a mismatch is
 *    rejected.
 */
export function checkAccess(
  req: Request,
  cfg: Config,
  level: "read" | "write" = "read",
): { ok: true } | { ok: false; reason: string } {
  const host = req.headers.get("host") ?? "";

  // Host-header allowlist — ALWAYS ON, before the Origin logic, so a rebinding request
  // (Host==Origin==evil) never reaches it. COLLIE_ALLOW_ANY_HOST=1 is the operator's explicit
  // opt-out and re-opens issue #3.
  if (!cfg.allowAnyHost && !isHostAllowed(host, cfg)) {
    return { ok: false, reason: "host not allowed" };
  }

  const origin = req.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return { ok: false, reason: "bad origin" };
    }
    // No loopback-Origin exemption: a page on http://localhost:NNNN is cross-origin to this bridge.
    // Local dev through the vite proxy re-permits itself via COLLIE_ALLOWED_ORIGINS.
    const allowed = originHost === host || cfg.allowedOrigins.includes(origin);
    if (!allowed) return { ok: false, reason: "cross-origin rejected" };
  } else if ((level === "write" || isStateChangingMethod(req)) && !LOOPBACK_HOST.test(host)) {
    // A state-changing request with no Origin header from a non-loopback Host isn't a real browser
    // request — refuse. Loopback (curl on the host) is still exempt.
    return { ok: false, reason: "origin required" };
  }

  if (cfg.trustedUser) {
    const login = req.headers.get("tailscale-user-login");
    if (login) {
      if (login !== cfg.trustedUser) return { ok: false, reason: "identity not trusted" };
    } else if (!cfg.skipServe && !cfg.trustedUserOptional) {
      // Fail closed: `tailscale serve` injects no Tailscale-User-* for TAGGED nodes, so an absent
      // header is not "a loopback caller" — it is any tagged node on the tailnet (issue #2). There
      // is no safe loopback exemption here: serve proxies from 127.0.0.1 so the peer IP is always
      // loopback, and the Host header is the client's to set.
      return { ok: false, reason: "identity required" };
    }
  }
  return { ok: true };
}

/**
 * Whether a Host header is one the bridge will answer to under the fail-closed host allowlist: a
 * loopback form, an explicit COLLIE_PUBLIC_HOSTS entry, a discovered Tailscale host (bare or with
 * port), or the host of a configured allowed origin. Pure + exported for tests.
 */
export function isHostAllowed(host: string, cfg: Config): boolean {
  if (!host) return false;
  if (LOOPBACK_HOST.test(host)) return true;
  if (cfg.publicHosts.includes(host)) return true;
  // Discovered Tailscale identities match bare or with any port: https serve answers on 443 (no
  // port in Host), http serve answers on COLLIE_PORT. One entry covers both modes.
  const bare = host.replace(/:\d+$/, "");
  if (cfg.tailscaleHosts.some((h) => h === host || h === bare)) return true;
  return cfg.allowedOrigins.some((o) => {
    try {
      return new URL(o).host === host;
    } catch {
      return false;
    }
  });
}

/**
 * Combined API gate used by every handler. A request must always pass {@link checkAccess}
 * (same-origin / CSRF + optional Tailscale identity). A `"write"` request — one that types into a
 * terminal or creates panes — must additionally come from an authorised device (see
 * {@link deviceAuth}). Returns a 403 Response to short-circuit on denial, or null to proceed.
 *
 * Exported for tests: {@link deviceAuth} being correct in isolation proves nothing if this wiring
 * regresses, and the write/read asymmetry below is exactly what a device gate stands or falls on.
 */
export function guard(req: Request, cfg: Config, level: "read" | "write"): Response | null {
  const gate = checkAccess(req, cfg, level);
  if (!gate.ok) return text(gate.reason, 403);
  if (level === "write" && !deviceAuth(req, cfg).authorized) {
    return text("device not authorised", 403);
  }
  return null;
}

/**
 * Optional per-device authorisation, layered on top of {@link checkAccess}. Off by default; enabled
 * by setting COLLIE_DEVICE_HEADER to the header a trusted upstream proxy injects, carrying an opaque
 * device identifier. The header is trusted only because the bridge binds loopback behind the proxy,
 * so a direct client can't forge it (the same trust basis as the Tailscale identity header). Matrix:
 *
 *   - feature off (no header configured) → not enforced, fully authorised (today's behaviour).
 *   - header absent                      → read-only, same as an unlisted device. Configuring the
 *                                          header is the operator asserting that the proxy sets it
 *                                          on every request, so a request without one did not come
 *                                          through that proxy and must not drive a terminal.
 *   - header present, value allowlisted  → authorised; the session is attributed to that device.
 *   - header present, value not listed   → read-only. The "unknown" sentinel is never authorised,
 *                                          and an empty allowlist makes every device read-only — a
 *                                          fail-closed default for a security toggle you turned on.
 *
 * "Read-only" is the whole scope of this gate, deliberately: {@link guard} consults it only for
 * `"write"`, so a header-less caller still reads panes. That is the existing design (a read-only
 * device is meant to watch), and this function does not change it. What changes is that a missing
 * header no longer counts as the operator.
 *
 * The absent-header case deliberately has no loopback exemption. It looks like the natural place for
 * one, but every supported front door is a proxy co-located with the bridge (tailscale serve and the
 * documented reverse proxies all connect to 127.0.0.1), so a loopback peer says nothing about
 * whether the caller is the operator on the host or a remote client whose proxy failed to inject the
 * header. Driving a pane from the host is still one flag away: send an allowlisted id yourself.
 */
export function deviceAuth(req: Request, cfg: Config): DeviceAuth {
  if (!cfg.deviceHeader) return { enforced: false, device: null, authorized: true };
  const raw = req.headers.get(cfg.deviceHeader);
  const device = raw?.trim() ? raw.trim() : null;
  if (!device) return { enforced: true, device: null, authorized: false };
  const authorized = device !== "unknown" && cfg.deviceAllowlist.includes(device);
  return { enforced: true, device, authorized };
}

// Apply the shared hardening headers (nosniff / no-referrer) to any response. Every response the
// bridge emits funnels through json(), text(), serveStatic(), or a handful of inline responses —
// all of which pass through here — so the headers are set exactly once, consistently.
function secure(res: Response): Response {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

function json(data: unknown, acceptEncoding: string | null, status = 200): Response {
  const response = gzipJsonResponse(data, acceptEncoding);
  if (status === 200) return secure(response);
  return secure(new Response(response.body, { status, headers: response.headers }));
}

/**
 * A JSON error body with a non-200 status (e.g. an unknown-session 404). The body is tiny (below the
 * gzip threshold), so a plain uncompressed JSON response is the whole story — no need for the gzip
 * path. `acceptEncoding` is accepted for call-site symmetry with {@link json} but not needed here.
 */
function jsonError(message: string, status: number, _acceptEncoding: string | null): Response {
  return secure(
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
  );
}

function text(body: string, status: number): Response {
  return secure(new Response(body, { status }));
}

/**
 * Decode one path segment, or null if the client sent a malformed percent-escape.
 *
 * `decodeURIComponent` throws `URIError` on input like `%ff` or `%E0%A4%A`. Every such throw used to
 * escape the fetch handler. Pure + exported so the malformed-input table is unit-tested without
 * standing up Bun.serve.
 */
export function decodePathSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * The single place an exception becomes a client-visible string.
 *
 * The real error — which routinely carries absolute journal, state-dir and Herdr-socket paths, and
 * for a socket failure the whole raw reply line — goes to the log, where the operator reads it with
 * `journalctl --user -u collie -f`. The client gets a fixed phrase naming only what was being
 * attempted. Never interpolate `err` into the return value.
 */
export function failureText(context: string, err: unknown): string {
  console.error(`[bridge] ${context} failed:`, err);
  return `${context} failed`;
}

/**
 * Whether a request body declares JSON. The gate on every JSON route: a cross-site POST can only
 * set text/plain, form-urlencoded or multipart without a CORS preflight, so demanding
 * application/json forces a preflight the bridge never answers. Pure + exported for tests.
 */
export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/** 415 short-circuit for a JSON route, or null to proceed. */
export function requireJsonBody(req: Request): Response | null {
  if (isJsonContentType(req.headers.get("content-type"))) return null;
  return text("expected application/json", 415);
}

/**
 * Validate an untrusted /api/notifications/prefs body into a partial patch. Only the known keys are
 * considered and each, if present, must be a boolean — a non-boolean value is rejected (null return
 * → 400). Unknown keys are ignored. An empty patch is valid (a no-op that echoes current prefs).
 * Pure + exported so the validation is unit-testable without Bun.serve.
 */
export function parseNotifyPrefsPatch(v: unknown): Partial<NotifyPrefs> | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const patch: Partial<NotifyPrefs> = {};
  for (const key of ["blocked", "done", "updates"] as const) {
    if (!(key in o)) continue;
    if (typeof o[key] !== "boolean") return null;
    patch[key] = o[key] as boolean;
  }
  return patch;
}

/**
 * The endpoint a subscribe body says it supersedes (`replaces`) — the row the same device last
 * registered, which nothing else can identify (bridge/push.ts, SubscriptionMeta).
 *
 * A bad value is IGNORED rather than rejected: the subscription itself is well-formed and must be
 * stored, and a client that got this field wrong would otherwise lose push entirely over a
 * housekeeping hint. The cap is only there so a junk field can't be persisted at length.
 */
function supersededEndpoint(body: unknown): string | undefined {
  const replaces = (body as { replaces?: unknown }).replaces;
  if (typeof replaces !== "string" || replaces === "" || replaces.length > 2048) return undefined;
  return replaces;
}

// Build id of the bundle currently on disk (written by the Vite build to dist/build-info.json).
// Surfaced via the X-Collie-Build header and /api/config so a stale, service-worker-cached client
// can tell it's behind. Cached by file mtime so a frontend rebuild (live, no restart) is picked up.
let buildCache: { id: string; mtime: number } | null = null;
async function buildId(): Promise<string> {
  try {
    const f = Bun.file(join(WEB_DIR, "build-info.json"));
    const mtime = f.lastModified;
    if (!buildCache || buildCache.mtime !== mtime) {
      const data = (await f.json()) as { id?: string };
      buildCache = { id: data.id ?? "unknown", mtime };
    }
    return buildCache.id;
  } catch {
    return "unknown";
  }
}

// The response header carrying the on-disk bundle's build id. A polling client reads it off every
// snapshot/pane response (web/src/lib/server-build.ts) to notice a live rebuild WITHOUT a service
// worker — the plain-HTTP deployments where the SW can't register, so the SW-based auto-reload never
// runs (see web/src/lib/self-update.ts). Also set on static responses (serveStatic). A named constant
// so both sides agree on the spelling.
export const BUILD_HEADER = "x-collie-build";

/**
 * Attach the current bundle's build id to a response so a polling client can observe a server-side
 * rebuild continuously, not just on a full document load. Pure given the id (the disk read stays in
 * buildId(), mtime-cached) — exported for unit tests.
 */
export function withBuildHeader(res: Response, id: string): Response {
  res.headers.set(BUILD_HEADER, id);
  return res;
}

/**
 * Resolve a request pathname to an absolute path under `webDir`, or null if it escapes. Pure +
 * exported for tests. The `full === webDir || full.startsWith(webDir + sep)` check rejects both
 * `..` traversal AND a sibling dir that merely shares the prefix (e.g. `web/dist-x` vs `web/dist`) —
 * a bare `startsWith(webDir)` would let the latter through.
 */
export function resolveStaticPath(
  pathname: string,
  webDir: string = WEB_DIR,
): { rel: string; full: string } | null {
  const raw = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const full = normalize(join(webDir, raw));
  if (full !== webDir && !full.startsWith(webDir + sep)) return null;
  // `rel` is derived from the NORMALISED path, never from the request string. Otherwise a dot
  // segment presents one path to the containment check above and a different one to the three
  // checks keyed on `rel` below: "/./build-info.json" would dodge the private-file denial
  // (issue #11), "/./sw.js" would lose its Service-Worker-Allowed header, and "/./assets/x.js"
  // would be served no-cache instead of immutable. Forward slashes so `rel` reads the same on
  // Windows as on the deployment host.
  return { rel: relative(webDir, full).split(sep).join("/"), full };
}

/**
 * The namespace reserved for the operator's front door. Matches `/auth` with or without a trailing
 * slash and anything beneath it — a proxy may serve one page or a whole flow. Kept in lockstep with
 * the service worker's navigation denylist (`web/src/lib/sw-routes.ts`); if these two disagree, an
 * installed PWA either can't reach the proxy or can't reach Collie. Pure + exported for tests.
 */
export function isReservedAuthPath(pathname: string): boolean {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}

/**
 * What `/auth/` says when nothing is in front of the bridge. Deliberately a 404: the path is
 * reserved, not implemented — Collie has no sign-in of its own and must not imply otherwise. Plain
 * HTML with no inline style or script (the strict CSP forbids both) and a link home, because in an
 * installed PWA this page may be the only thing on screen and there is no address bar to leave it.
 * Unauthenticated by design: it sits outside every gate, since the reason to be here is that a gate
 * refused you.
 */
function reservedAuthPlaceholder(): Response {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Nothing configured here — Collie</title>
</head>
<body>
<h1>Nothing is configured at this address</h1>
<p>Collie reserves <code>/auth/</code> for a reverse proxy sitting in front of it, so that an
installed app has somewhere to reach a sign-in or device-enrolment page. Collie itself serves
nothing here and has no sign-in of its own.</p>
<p>If you are the operator: point this path at your proxy's sign-in flow. See <em>Serving Collie
behind your own reverse proxy</em> in the README.</p>
<p><a href="/">Back to Collie</a></p>
</body>
</html>
`;
  return secure(
    new Response(body, {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": CSP,
        "cache-control": "no-store",
      },
    }),
  );
}

async function serveStatic(pathname: string, host: string, cfg: Config): Promise<Response> {
  // The Host allowlist, which every /api/* route gets via guard() → checkAccess. The static route
  // was the last one that skipped it, so with COLLIE_PUBLIC_HOSTS set a rebound DNS name was still
  // served the app shell, build-info.json, and the X-Collie-Build header on every asset — the same
  // hole that was closed for /api/config in #32 (issue #11). Deliberately ONLY the host check and
  // not guard(): a top-level navigation carries no Origin, and the identity gate would 403 the whole
  // PWA rather than one endpoint. Rebinding is a Host problem. First, before any path handling, so a
  // rebound host cannot tell 403/404/503 apart by probing paths.
  if (cfg.publicHosts.length > 0 && !isHostAllowed(host, cfg)) return text("host not allowed", 403);

  const resolved = resolveStaticPath(pathname);
  if (!resolved) return text("forbidden", 403);
  let { rel, full } = resolved;

  // 404, not 403: a refusal that differs from "no such file" confirms the file is there.
  if (isPrivateStaticFile(rel)) return text("not found", 404);

  let file = Bun.file(full);
  if (!(await file.exists())) {
    // SPA fallback: extension-less paths fall back to index.html; missing assets 404.
    if (extname(rel) === "") {
      rel = "index.html";
      full = join(WEB_DIR, "index.html");
      file = Bun.file(full);
      if (!(await file.exists())) {
        return text("frontend not built — run `bun run build` in web/", 503);
      }
    } else {
      return text("not found", 404);
    }
  }

  const ext = extname(full);
  const headers: Record<string, string> = {
    "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    [BUILD_HEADER]: await buildId(), // which bundle the server is serving (vs the client's stamp)
    "cache-control": cacheControlFor(rel),
  };
  if (ext === ".html") headers["content-security-policy"] = CSP;
  if (rel === "sw.js") headers["service-worker-allowed"] = "/";
  return secure(new Response(file, { headers }));
}

/**
 * Cache-Control for a served dist file, keyed by its path relative to web/dist. Hashed assets under
 * `assets/` are content-addressed, so cache them hard + immutable. EVERYTHING else — index.html,
 * sw.js, manifest.webmanifest, the favicons — is MUTABLE across a rebuild and must
 * always be revalidated (`no-cache`), so neither the browser NOR an intermediary reverse proxy can
 * pin a stale copy. This matters most for sw.js: a proxy that heuristically caches it (it shipped
 * with no Cache-Control before) starves `registration.update()` and wedges the whole SW update
 * pipeline — the exact failure the API-observed self-update (web/src/lib/self-update.ts) works around,
 * but which this header prevents at the source. Pure + exported for unit tests.
 */
export function cacheControlFor(rel: string): string {
  return rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
}

/**
 * Dist files that exist on disk but must never be answered over HTTP.
 *
 * `build-info.json` is the build id in a file. Nothing fetches it: the bridge reads it off DISK for
 * the X-Collie-Build header and /api/config (see `buildId`), collie-ctl reads it off disk, and the
 * frontend learns the server build from that header and from /api/config — it has no fetch for this
 * path. Serving it was purely an artefact of the whole dist tree being public, and it put the build
 * id behind no gate at all (issue #11). Pure + exported for unit tests.
 */
export function isPrivateStaticFile(rel: string): boolean {
  return rel === "build-info.json";
}
