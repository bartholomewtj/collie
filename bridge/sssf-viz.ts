/**
 * SSSF traces tab — mounts the Super Simple Software Factory visualiser (an external Vue app) at
 * `/sssf/` and its API at `/sssf/api/*`, one trace db per workspace.
 *
 * The whole feature lives in this file. server.ts calls exactly three things: `owns(pathname)` +
 * `handle(req, url)` at the top of its fetch, and `decorate(workspaces, panes, session)` in the
 * snapshot. Nothing here runs when `SSSF_VIZ_DIR` is unset — `owns()` is false, `decorate()` is the
 * identity, and Collie behaves as it did before this file existed.
 *
 * Point, don't copy: `SSSF_VIZ_DIR` names the visualiser's source folder (normally
 * `~/.claude/skills/sssf/apps/visualizer`). Collie imports its `server/db.ts` for the sqlite reads,
 * builds its UI with Vite into Collie's own state dir, and serves that. The Collie repo contains none
 * of the visualiser. Editing the visualiser → restart Collie → it rebuilds.
 *
 * Which db: Herdr's `workspace.list` carries no directory, but every pane reports a `cwd`. For each
 * workspace, walk each pane cwd upward and accept a directory only if it is a git worktree root that
 * holds `adws/adw_data/sssf.db`. The path never leaves the bridge; the client sends a workspace id.
 *
 * Trust: the visualiser folder is code Collie executes (its `db.ts` in-process, its Vite config at
 * build time). See .adr/0011. Inside Collie the UI is framed with `sandbox="allow-scripts"` (opaque
 * origin), so its JS cannot reach Collie's own `/api/*`; the price is that its calls arrive with
 * `Origin: null`, which this module accepts on its READ routes only when the request also carries
 * the per-boot token Collie put in the iframe URL — a token no other site can learn.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Config } from "./config.ts";
import { containedRealpath, exists } from "./journal/files.ts";
import type { WorkspaceView } from "./types.ts";

// ── Wiring from server.ts ────────────────────────────────────────────────────

/** The bits of server.ts this module reuses. Passed in, so the two files don't import each other. */
export interface SssfHelpers {
  guard: (req: Request, cfg: Config, level: "read" | "write") => Response | null;
  isHostAllowed: (host: string, cfg: Config) => boolean;
  requireJsonBody: (req: Request) => Response | null;
  failureText: (context: string, err: unknown) => string;
  resolveStaticPath: (pathname: string, dir: string) => { rel: string; full: string } | null;
  cacheControlFor: (rel: string) => string;
  secure: (res: Response) => Response;
  /** Collie's html CSP; this module swaps `frame-ancestors 'none'` for `'self'` on its own page. */
  csp: string;
  contentTypes: Record<string, string>;
}

/** What the visualiser's server/db.ts must export for this module to use it. Checked at startup. */
interface SssfDbApi {
  path: string;
  journalMode: string;
  sessionsDir: string;
  sessionCount(): number;
  sessions(limit?: number): unknown[];
  session(adwId: string): unknown | null;
  sessionDetail(adwId: string): unknown | null;
  events(adwId: string, after?: number, limit?: number): unknown;
  envelopes(adwId: string): unknown[];
  gates(adwId: string): unknown[];
  setArchived(adwId: string, archived: boolean): boolean;
  close(): void;
}
const DB_METHODS = [
  "sessionCount",
  "sessions",
  "session",
  "sessionDetail",
  "events",
  "envelopes",
  "gates",
  "setArchived",
  "close",
] as const;

type SssfDbCtor = new (path: string) => SssfDbApi;

/** Any pane shape with the two fields discovery needs (AgentView has both). */
interface PaneLike {
  workspaceId: string;
  cwd: string;
}

export type SssfState = "ready" | "pending";

/** What a workspace carries in the snapshot when the feature is on. */
export interface WorkspaceSssf {
  state: SssfState;
  /** Per-boot token the iframe URL must carry — see the header on `Origin: null`. */
  token: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const SSSF_PREFIX = "/sssf";
const DB_REL = join("adws", "adw_data", "sssf.db");
const MAX_WALK = 8;
const RECHECK_MS = 30_000;
const PROMPT_CAP_BYTES = 256 * 1024;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 1000;
const DEFAULT_EVENTS_LIMIT = 500;
const MAX_EVENTS_LIMIT = 5000;
/** An id or agent name is one plain path segment: safe chars only, and never `.` or `..`. */
const SAFE_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,128}$/;
/** Files whose newest mtime decides whether the UI must be rebuilt. */
const SOURCE_ROOTS = ["src", "shared", "public"];
const SOURCE_FILES = ["index.html", "package.json", "bun.lock", "vite.config.ts"];
/** Env the build subprocess gets — the OS basics only, never Collie's own configuration. */
const BUILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "COMSPEC",
  "PATHEXT",
  "LANG",
  "LC_ALL",
];

// ── Module ───────────────────────────────────────────────────────────────────

export interface SssfViz {
  /** Resolves once the startup contract check has run (true = feature on). Tests await this. */
  ready: Promise<boolean>;
  /** True for `/sssf` and everything beneath it. False forever when the feature is off. */
  owns(pathname: string): boolean;
  handle(req: Request, url: URL): Promise<Response>;
  /** Stamp each workspace with its trace state (and refresh discovery from the panes' cwds). */
  decorate(workspaces: WorkspaceView[], panes: readonly PaneLike[], session?: string): WorkspaceView[];
  /** For the shutdown path. */
  dispose(): void;
}

/** Read `SSSF_VIZ_DIR` (`~` expanded, made absolute) or "" when unset. */
export function readVizDir(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.SSSF_VIZ_DIR ?? "").trim();
  if (!raw) return "";
  const expanded = raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\")
    ? join(homedir(), raw.slice(1))
    : raw;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

export interface SssfOptions {
  /** Skip the Vite build (tests exercise the API and discovery only). Default: build. */
  build?: boolean;
  /** Override SSSF_VIZ_DIR (tests). Default: read from the environment. */
  vizDir?: string;
}

export function createSssfViz(cfg: Config, h: SssfHelpers, opts: SssfOptions = {}): SssfViz {
  // Re-pointed at its real path once the folder is confirmed to exist — a case-different or
  // symlinked SSSF_VIZ_DIR otherwise hands Vite paths that don't match the disk (Bun's recursive
  // mkdir on Windows reports EEXIST for a case-mismatched existing dir).
  let vizDir = opts.vizDir ?? readVizDir();
  const distDir = join(cfg.stateDir, "sssf-viz", "dist");
  const token = randomBytes(24).toString("hex");
  const log = (msg: string) => console.warn(`[sssf] ${msg}`);

  // Feature state. `enabled` flips true only after the contract check passes; `built` after Vite
  // has produced dist/index.html (initially true when a previous run's dist is still fresh).
  let enabled = false;
  let Db: SssfDbCtor | null = null;
  let building: Promise<void> | null = null;
  let buildError: string | null = null;

  // Discovery: per workspace (scoped by herdr session), the resolved db path or "pending", plus
  // the pane-cwd fingerprint and time it was computed against. Open dbs are shared per path.
  interface Found {
    /** "none": walked, nothing SSSF-shaped above any pane — decorates as nothing. */
    state: SssfState | "none";
    dbPath: string | null;
    fingerprint: string;
    at: number;
  }
  const found = new Map<string, Found>();
  const dbs = new Map<string, SssfDbApi>();
  const inflightDiscovery = new Set<string>();

  const wsKey = (session: string | undefined, workspaceId: string) => `${session ?? ""}|${workspaceId}`;

  // ── Startup ────────────────────────────────────────────────────────────

  const ready: Promise<boolean> = vizDir ? start() : Promise.resolve(false);

  async function start(): Promise<boolean> {
    try {
      const ok = await contractCheck();
      if (!ok) return false;
      enabled = true;
      if (opts.build === false) return true;
      // Serve a still-fresh dist immediately; otherwise (or when stale) rebuild in the background.
      const stale = await isStale();
      if (stale) building = build().finally(() => (building = null));
      else log(`serving ${distDir}`);
      return true;
    } catch (err) {
      log(`disabled: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * All-or-nothing: the folder is there, its db.ts exports what we call, and the visualiser carries
   * the host-mount patches (BASE_URL-relative URLs). A skill re-install that wiped those would
   * otherwise build a UI that fetches Collie's own /api — better to switch off loudly.
   */
  async function contractCheck(): Promise<boolean> {
    if (!(await exists(vizDir))) {
      log(`disabled: SSSF_VIZ_DIR ${vizDir} does not exist`);
      return false;
    }
    vizDir = await realpath(vizDir);
    const dbTs = join(vizDir, "server", "db.ts");
    if (!(await exists(dbTs))) {
      log(`disabled: ${dbTs} not found — is SSSF_VIZ_DIR the visualizer folder?`);
      return false;
    }
    const apiTs = await Bun.file(join(vizDir, "src", "lib", "api.ts")).text().catch(() => "");
    if (!apiTs.includes("BASE_URL")) {
      log("disabled: the visualiser is not host-mountable (src/lib/api.ts lacks BASE_URL-relative URLs)");
      return false;
    }
    const mod = (await import(pathToFileURL(dbTs).href)) as { SssfDb?: unknown };
    const ctor = mod.SssfDb;
    if (typeof ctor !== "function") {
      log("disabled: server/db.ts exports no SssfDb class");
      return false;
    }
    const proto = (ctor as { prototype: Record<string, unknown> }).prototype;
    const missing = DB_METHODS.filter((m) => typeof proto[m] !== "function");
    if (missing.length) {
      log(`disabled: SssfDb is missing ${missing.join(", ")} — the visualiser changed; update this module`);
      return false;
    }
    Db = ctor as SssfDbCtor;
    const pkg = (await Bun.file(join(vizDir, "package.json"))
      .json()
      .catch(() => ({}))) as { version?: string };
    log(`visualiser ${pkg.version ?? "?"} at ${vizDir}`);
    return true;
  }

  // ── Build ──────────────────────────────────────────────────────────────

  async function newestSourceMtime(): Promise<number> {
    let newest = 0;
    const consider = async (p: string) => {
      const s = await stat(p).catch(() => null);
      if (s && s.mtimeMs > newest) newest = s.mtimeMs;
    };
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else await consider(p);
      }
    };
    for (const r of SOURCE_ROOTS) await walk(join(vizDir, r));
    for (const f of SOURCE_FILES) await consider(join(vizDir, f));
    return newest;
  }

  async function isStale(): Promise<boolean> {
    const built = await stat(join(distDir, "index.html")).catch(() => null);
    if (!built) return true;
    return (await newestSourceMtime()) > built.mtimeMs;
  }

  /** Run a subprocess in the visualiser folder with the OS-basics env only. */
  async function run(cmd: string[], label: string): Promise<void> {
    const env: Record<string, string> = {};
    for (const k of BUILD_ENV_KEYS) {
      const v = process.env[k];
      if (v !== undefined) env[k] = v;
    }
    const proc = Bun.spawn(cmd, { cwd: vizDir, env, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      throw new Error(`${label} exited ${code}: ${(err || out).trim().slice(-800)}`);
    }
  }

  async function build(): Promise<void> {
    buildError = null;
    try {
      const lock = await stat(join(vizDir, "bun.lock")).catch(() => null);
      const mods = await stat(join(vizDir, "node_modules")).catch(() => null);
      if (!mods || (lock && lock.mtimeMs > mods.mtimeMs)) {
        log("installing visualiser dependencies (frozen lockfile)");
        await run([process.execPath, "install", "--frozen-lockfile"], "bun install");
      }
      const vite = join(vizDir, "node_modules", "vite", "bin", "vite.js");
      if (!(await exists(vite))) throw new Error("vite not found under node_modules after install");
      // Vite's config-bundling scratch dir; a leftover from an interrupted build makes the next one
      // fail with EEXIST on this runtime, so it is cleared first.
      await rm(join(vizDir, "node_modules", ".vite-temp"), { recursive: true, force: true });
      const srcHash = createHash("sha256").update(String(await newestSourceMtime())).digest("hex").slice(0, 12);
      log(`building visualiser ui → ${distDir} (source ${srcHash})`);
      await run(
        [process.execPath, vite, "build", `--base=${SSSF_PREFIX}/`, `--outDir=${distDir}`, "--emptyOutDir"],
        "vite build",
      );
      log("visualiser ui built");
    } catch (err) {
      buildError = err instanceof Error ? err.message : String(err);
      log(`build failed: ${buildError}`);
    }
  }

  // ── Discovery ──────────────────────────────────────────────────────────

  /**
   * Walk up from `cwd`; the first git worktree root with `adws/adw_data/sssf.db` wins. A worktree
   * root with an `adws/` dir but no db yet is "pending". Anything else: nothing.
   */
  async function locate(cwd: string): Promise<Found | null> {
    let dir = resolve(cwd);
    let pending = false;
    for (let i = 0; i <= MAX_WALK; i++) {
      // .git may be a directory (a checkout) or a file (a linked worktree) — either marks a root.
      if (await exists(join(dir, ".git"))) {
        const db = join(dir, DB_REL);
        if (await exists(db)) return { state: "ready", dbPath: db, fingerprint: "", at: 0 };
        if (await exists(join(dir, "adws"))) pending = true;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return pending ? { state: "pending", dbPath: null, fingerprint: "", at: 0 } : null;
  }

  async function discover(key: string, cwds: string[], fingerprint: string): Promise<void> {
    if (inflightDiscovery.has(key)) return;
    inflightDiscovery.add(key);
    try {
      let best: Found | null = null;
      for (const cwd of cwds) {
        const hit = await locate(cwd);
        if (hit?.state === "ready") {
          best = hit;
          break;
        }
        if (hit && !best) best = hit;
      }
      // "none" is remembered too, so a workspace with no traces isn't re-walked every snapshot.
      found.set(key, best ? { ...best, fingerprint, at: Date.now() } : { state: "none", dbPath: null, fingerprint, at: Date.now() });
    } finally {
      inflightDiscovery.delete(key);
    }
  }

  function decorate(workspaces: WorkspaceView[], panes: readonly PaneLike[], session?: string): WorkspaceView[] {
    if (!enabled) return workspaces;
    return workspaces.map((w) => {
      const key = wsKey(session, w.workspaceId);
      const cwds = [...new Set(panes.filter((p) => p.workspaceId === w.workspaceId).map((p) => p.cwd))]
        .filter(Boolean)
        .sort();
      const fingerprint = cwds.join("\n");
      const cur = found.get(key);
      const due = !cur || cur.fingerprint !== fingerprint || Date.now() - cur.at > RECHECK_MS;
      if (due && cwds.length) void discover(key, cwds, fingerprint);
      if (!cur || cur.state === "none") return w;
      const sssf: WorkspaceSssf = { state: cur.state, token };
      return { ...w, sssf };
    });
  }

  function dbFor(session: string | undefined, workspaceId: string): SssfDbApi | null {
    const cur = found.get(wsKey(session, workspaceId));
    if (!cur?.dbPath || !Db) return null;
    let db = dbs.get(cur.dbPath);
    if (!db) {
      db = new Db(cur.dbPath);
      dbs.set(cur.dbPath, db);
    }
    return db;
  }

  // ── HTTP ───────────────────────────────────────────────────────────────

  const text = (body: string, status: number) => h.secure(new Response(body, { status }));
  const json = (data: unknown, status = 200) =>
    h.secure(
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      }),
    );

  function owns(pathname: string): boolean {
    return vizDir !== "" && (pathname === SSSF_PREFIX || pathname.startsWith(SSSF_PREFIX + "/"));
  }

  function tokenOk(candidate: string | null): boolean {
    if (!candidate || candidate.length !== token.length) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
  }

  async function handle(req: Request, url: URL): Promise<Response> {
    // Host allowlist FIRST — before the redirect, the 503 and the 404 — for the same reason
    // serveStatic does it: a rebound DNS name must not learn whether the feature is on.
    const host = req.headers.get("host") ?? "";
    if (!cfg.allowAnyHost && !h.isHostAllowed(host, cfg)) return text("host not allowed", 403);
    if (!enabled) return text("not found", 404);

    const pathname = url.pathname;
    if (pathname === SSSF_PREFIX) {
      return h.secure(new Response(null, { status: 301, headers: { location: `${SSSF_PREFIX}/${url.search}` } }));
    }
    if (pathname.startsWith(`${SSSF_PREFIX}/api/`)) return api(req, url, pathname.slice(SSSF_PREFIX.length + 4));
    return serveStatic(pathname.slice(SSSF_PREFIX.length));
  }

  /**
   * The sandboxed iframe's requests carry `Origin: null`. checkAccess would refuse that as a bad
   * origin, so when the per-boot token matches we present the request WITHOUT its Origin — which
   * checkAccess treats as a same-origin GET (host, method and identity checks still run) — and
   * answer with the CORS header the opaque origin needs to read the body. Reads only: state changes
   * keep their real Origin, and a null one is (rightly) refused.
   */
  function forGuard(req: Request, url: URL): { req: Request; cors: boolean } {
    if (req.headers.get("origin") !== "null" || req.method !== "GET" || !tokenOk(url.searchParams.get("t"))) {
      return { req, cors: false };
    }
    const headers = new Headers(req.headers);
    headers.delete("origin");
    return { req: new Request(req.url, { method: req.method, headers }), cors: true };
  }

  function withCors(res: Response, cors: boolean): Response {
    if (cors) {
      res.headers.set("access-control-allow-origin", "null");
      res.headers.set("vary", "Origin");
    }
    return res;
  }

  function intParam(url: URL, name: string, fallback: number, max: number): number {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return fallback;
    return Math.min(n, max);
  }

  async function api(req: Request, url: URL, rest: string): Promise<Response> {
    const session = url.searchParams.get("session") ?? undefined;
    const workspaceId = url.searchParams.get("ws") ?? "";
    const parts = rest.split("/").filter(Boolean);
    const isWrite = req.method === "POST" && parts[0] === "sessions" && parts[2] === "archive";

    const g = forGuard(req, url);
    const denied = h.guard(g.req, cfg, isWrite ? "write" : "read");
    if (denied) return denied;
    if (isWrite) {
      const bad = h.requireJsonBody(req);
      if (bad) return bad;
    }

    try {
      const db = workspaceId ? dbFor(session, workspaceId) : null;
      if (!db) return withCors(json({ error: "no traces for this workspace" }, 404), g.cors);

      // /health
      if (parts.length === 1 && parts[0] === "health") {
        return withCors(json({ ok: true, journal_mode: db.journalMode, sessions: db.sessionCount() }), g.cors);
      }
      if (parts[0] !== "sessions") return withCors(json({ error: "no route" }, 404), g.cors);
      // /sessions
      if (parts.length === 1) {
        return withCors(json(db.sessions(intParam(url, "limit", DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT))), g.cors);
      }
      const adwId = parts[1] ?? "";
      if (!SAFE_SEGMENT.test(adwId)) return withCors(json({ error: "invalid adw_id" }, 400), g.cors);
      // /sessions/:id
      if (parts.length === 2) {
        const detail = db.sessionDetail(adwId);
        return withCors(detail ? json(detail) : json({ error: `no session ${adwId}` }, 404), g.cors);
      }
      const leaf = parts[2];
      if (parts.length === 3 && leaf === "events") {
        return withCors(
          json(db.events(adwId, intParam(url, "after", 0, Number.MAX_SAFE_INTEGER), intParam(url, "limit", DEFAULT_EVENTS_LIMIT, MAX_EVENTS_LIMIT))),
          g.cors,
        );
      }
      if (parts.length === 3 && leaf === "envelopes") return withCors(json(db.envelopes(adwId)), g.cors);
      if (parts.length === 3 && leaf === "gates") return withCors(json(db.gates(adwId)), g.cors);
      if (parts.length === 3 && leaf === "archive" && isWrite) {
        const body = (await req.json().catch(() => ({}))) as { archived?: unknown };
        const archived = body.archived === undefined ? true : Boolean(body.archived);
        return db.setArchived(adwId, archived)
          ? json({ adw_id: adwId, archived })
          : json({ error: `no session ${adwId}` }, 404);
      }
      // /sessions/:id/agents/:agent/prompts
      if (parts.length === 5 && leaf === "agents" && parts[4] === "prompts") {
        const agent = parts[3] ?? "";
        if (!SAFE_SEGMENT.test(agent)) return withCors(json({ error: "invalid agent" }, 400), g.cors);
        if (!db.session(adwId)) return withCors(json({ error: `no session ${adwId}` }, 404), g.cors);
        return withCors(json(await readPrompts(db.sessionsDir, adwId, agent)), g.cors);
      }
      return withCors(json({ error: "no route" }, 404), g.cors);
    } catch (err) {
      return withCors(text(h.failureText("sssf api", err), 500), g.cors);
    }
  }

  /**
   * The exact prompts an agent was sent — files the ADW wrote under the db's sessions dir. Read the
   * Collie way: symlinks resolved, containment checked on the REAL path, size capped. Off entirely
   * when transcripts are off (COLLIE_TRANSCRIPT=off), which is the operator's "serve no agent text"
   * switch. Absent files read as null — the agent simply never ran in this session.
   */
  async function readPrompts(sessionsDir: string, adwId: string, agent: string): Promise<{ system: string | null; user: string | null }> {
    if (!cfg.transcript) return { system: null, user: null };
    const read = async (name: string): Promise<string | null> => {
      const candidate = join(sessionsDir, adwId, agent, "prompts", `${name}.md`);
      const real = await containedRealpath(candidate, sessionsDir);
      if (!real) return null;
      const file = Bun.file(real);
      const size = file.size;
      if (size > PROMPT_CAP_BYTES) {
        return `${await file.slice(0, PROMPT_CAP_BYTES).text()}\n\n… (truncated at ${PROMPT_CAP_BYTES} bytes)`;
      }
      return file.text();
    };
    return { system: await read("system"), user: await read("user") };
  }

  async function serveStatic(rel: string): Promise<Response> {
    if (building || buildError || !(await exists(join(distDir, "index.html")))) {
      if (buildError) return text(`sssf visualiser build failed — see the bridge log`, 503);
      return text("sssf visualiser is building — retry in a few seconds", 503);
    }
    const resolved = h.resolveStaticPath(rel || "/", distDir);
    if (!resolved) return text("forbidden", 403);
    let { rel: r, full } = resolved;
    let file = Bun.file(full);
    if (!(await file.exists())) {
      if (extname(r) !== "") return text("not found", 404);
      r = "index.html";
      full = join(distDir, "index.html");
      file = Bun.file(full);
    }
    const ext = extname(full);
    const headers: Record<string, string> = {
      "content-type": h.contentTypes[ext] ?? "application/octet-stream",
      "cache-control": h.cacheControlFor(r),
    };
    if (ext === ".html") {
      // Same CSP as Collie's own pages, except this one may be framed — by Collie only.
      headers["content-security-policy"] = h.csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
    } else if (r.startsWith("assets/")) {
      // Fonts load in CORS mode; from the sandboxed (opaque-origin) frame they need this. The assets
      // are content-hashed public bundles — nothing here is per-user.
      headers["access-control-allow-origin"] = "*";
    }
    return h.secure(new Response(file, { headers }));
  }

  function dispose(): void {
    for (const db of dbs.values()) {
      try {
        db.close();
      } catch {
        /* closing is best-effort */
      }
    }
    dbs.clear();
  }

  return { ready, owns, handle, decorate, dispose };
}

/** Exported for tests: is this a path segment the API accepts as an adw id / agent name? */
export function isSafeSegment(s: string): boolean {
  return SAFE_SEGMENT.test(s);
}
