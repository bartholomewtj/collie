/**
 * SSSF traces tab — mounts the Super Simple Software Factory visualiser (an external Vue app) at
 * `/sssf/` and its API at `/sssf/api/*`, one trace db per workspace.
 *
 * The whole feature lives in this file. server.ts calls exactly four things: `owns(pathname)` +
 * `handle(req, url)` at the top of its fetch, and `decorate(workspaces, panes, session)` +
 * `decoratePanes(panes, session)` in the snapshot. Nothing here runs when `SSSF_VIZ_DIR` is unset — `owns()` is false, `decorate()` is the
 * identity, and Collie behaves as it did before this file existed.
 *
 * Point, don't copy: `SSSF_VIZ_DIR` names the visualiser's source folder (normally
 * `~/.claude/skills/sssf/apps/visualizer`). Collie imports its `server/db.ts` for the sqlite reads,
 * builds its UI with Vite into Collie's own state dir, and serves that. The Collie repo contains none
 * of the visualiser. Editing the visualiser → restart Collie → it rebuilds.
 *
 * Which db: Herdr's `workspace.list` carries no directory, but every pane reports a `cwd`. For each
 * workspace, look near each pane cwd — up to the enclosing git worktree root, and a bounded two
 * levels down (a pane parked in a folder of repos) — for roots holding `adws/adw_data/sssf.db`. The
 * workspace attaches to the repo with the newest run (a running one first) and the frame opens on
 * that run; several repos give the client a name per repo to pick from. Paths never leave the
 * bridge: the client sends a workspace id and a repo *name*, which is only ever a Map lookup.
 *
 * Which pane: Herdr exports `HERDR_PANE_ID` into every pane, and an SSSF tracer (claudeSSSF from
 * 2026-08-18) records it on the run's `sessions` row as `pane_id`. Discovery indexes each repo's
 * runs by that id, and `decoratePanes` stamps every pane with the runs it launched — that is what
 * the pane's Traces button opens on. A run started outside a pane (a scheduler, a plain terminal)
 * has no pane and simply appears on none; nothing is inferred from cwd or timing.
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
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Config } from "./config.ts";
import { containedRealpath, exists } from "./journal/files.ts";
import type { PaneSssf, PaneSssfRun, WorkspaceView } from "./types.ts";

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
/** What `decoratePanes` needs on top: the id a tracer would have recorded. */
interface StampablePane extends PaneLike {
  paneId: string;
  sssf?: PaneSssf;
}

export type SssfState = "ready" | "pending";

/** What a workspace carries in the snapshot when the feature is on. */
export interface WorkspaceSssf {
  /** Roll-up: "ready" when any repo has a db. */
  state: SssfState;
  /** Per-boot token the iframe URL must carry — see the header on `Origin: null`. */
  token: string;
  /** Every SSSF repo found near the workspace's panes, by name (never a path). */
  repos: Array<{ name: string; state: SssfState; running: boolean }>;
  /** The repo whose newest run is the most recent (a running one wins), and that run if it's live. */
  attached?: { repo: string; adwId?: string };
}

/** A git worktree root that is (or is about to be) an SSSF repo. `dbPath` null = pending. */
export interface SssfCandidate {
  name: string;
  root: string;
  dbPath: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const SSSF_PREFIX = "/sssf";
const DB_REL = join("adws", "adw_data", "sssf.db");
const MAX_WALK = 8;
/** Down-scan bounds: how many levels below a pane cwd, how many entries read per directory. */
const MAX_DOWN = 2;
const MAX_DIRENTS = 200;
/** Directory names the down-scan never enters (dot-dirs are skipped too). */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "target", "venv", "__pycache__"]);
const RECHECK_MS = 30_000;
const PROMPT_CAP_BYTES = 256 * 1024;
const DEFAULT_LIST_LIMIT = 200;
/** Runs listed per pane (newest first) — a pane that has launched more shows the latest of them. */
const PANE_RUNS_CAP = 20;
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
  /** Stamp each pane with the ADW runs it launched (`sssf.runs`), from the last discovery pass. */
  decoratePanes<T extends StampablePane>(panes: T[], session?: string): T[];
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

  // Discovery: per workspace (scoped by herdr session), the SSSF repos found near its panes and
  // which one it is attached to, plus the pane-cwd fingerprint and time it was computed against.
  // Open dbs are shared per path; the filesystem scan is shared per cwd.
  interface FoundRepo extends SssfCandidate {
    running: boolean;
    /** ISO `started_at` of the newest session, "" when the db has none (or is pending). */
    newest: string;
  }
  interface Found {
    /** "none": scanned, nothing SSSF-shaped near any pane — decorates as nothing. */
    state: SssfState | "none";
    repos: FoundRepo[];
    attached: { repo: string; adwId?: string } | undefined;
    /** Runs by the pane that launched them (`sessions.pane_id`), newest first, capped. */
    paneRuns: Map<string, PaneSssfRun[]>;
    fingerprint: string;
    at: number;
  }
  const found = new Map<string, Found>();
  const dbs = new Map<string, SssfDbApi>();
  const inflightDiscovery = new Set<string>();
  const cwdCache = new Map<string, { at: number; repos: SssfCandidate[] }>();

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
   * The SSSF repos near one pane cwd: walk UP to the nearest git worktree root (a pane opened inside
   * a repo), and scan DOWN a couple of levels (a pane opened in a folder OF repos — the common shape
   * here, where the agent runs the ADW in `Projects/<repo>` by path and the pane never moves).
   * Cached per cwd for RECHECK_MS so several workspaces at the same cwd share one scan.
   */
  async function reposNear(cwd: string): Promise<SssfCandidate[]> {
    const hit = cwdCache.get(cwd);
    if (hit && Date.now() - hit.at < RECHECK_MS) return hit.repos;
    const repos = await findRepos(cwd);
    cwdCache.set(cwd, { at: Date.now(), repos });
    return repos;
  }

  /** One row of the visualiser's sessions() as this module reads it (every field optional on the
   *  wire — an older tracer's db lacks `adw_name` and `pane_id`, and db.ts NULLs them). */
  interface SessionRow {
    adw_id?: unknown;
    adw_name?: unknown;
    status?: unknown;
    started_at?: unknown;
    pane_id?: unknown;
  }

  /** A repo's recent sessions (the visualiser lists newest-first), through the shared handle: the
   *  newest one decides attachment; the ones carrying a `pane_id` are handed to their pane. */
  function readSessions(c: SssfCandidate, repoName: string): {
    running: boolean;
    newest: string;
    adwId?: string;
    byPane: Map<string, PaneSssfRun[]>;
  } {
    const byPane = new Map<string, PaneSssfRun[]>();
    if (!c.dbPath || !Db) return { running: false, newest: "", byPane };
    try {
      const rows = openDb(c.dbPath).sessions(DEFAULT_LIST_LIMIT) as SessionRow[];
      for (const r of rows) {
        if (typeof r.pane_id !== "string" || !r.pane_id || typeof r.adw_id !== "string") continue;
        const run: PaneSssfRun = {
          repo: repoName,
          adwId: r.adw_id,
          ...(typeof r.adw_name === "string" && r.adw_name ? { adwName: r.adw_name } : {}),
          status: typeof r.status === "string" ? r.status : "unknown",
          startedAt: typeof r.started_at === "string" ? r.started_at : "",
        };
        const list = byPane.get(r.pane_id);
        if (list) list.push(run);
        else byPane.set(r.pane_id, [run]);
      }
      const [s] = rows;
      if (!s) return { running: false, newest: "", byPane };
      return {
        running: s.status === "running",
        newest: typeof s.started_at === "string" ? s.started_at : "",
        ...(typeof s.adw_id === "string" ? { adwId: s.adw_id } : {}),
        byPane,
      };
    } catch (err) {
      log(`cannot read ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
      return { running: false, newest: "", byPane };
    }
  }

  async function discover(key: string, cwds: string[], fingerprint: string): Promise<void> {
    if (inflightDiscovery.has(key)) return;
    inflightDiscovery.add(key);
    try {
      // Union across the workspace's pane cwds, deduped by root; names made unique so a name is
      // always one repo (two worktrees called `app` become `app` and `app-2`).
      const byRoot = new Map<string, SssfCandidate>();
      for (const cwd of cwds) for (const c of await reposNear(cwd)) byRoot.set(c.root, c);
      const names = new Set<string>();
      const repos: FoundRepo[] = [];
      const paneRuns = new Map<string, PaneSssfRun[]>();
      let best: { name: string; running: boolean; newest: string; adwId?: string } | null = null;
      for (const c of [...byRoot.values()].sort((a, b) => a.root.localeCompare(b.root))) {
        let name = c.name;
        for (let n = 2; names.has(name); n++) name = `${c.name}-${n}`;
        names.add(name);
        const { byPane, ...s } = readSessions(c, name);
        repos.push({ ...c, name, running: s.running, newest: s.newest });
        for (const [paneId, runs] of byPane) {
          const list = paneRuns.get(paneId);
          if (list) list.push(...runs);
          else paneRuns.set(paneId, runs);
        }
        if (!c.dbPath) continue;
        // A running run beats any finished one; otherwise the most recently started wins.
        if (!best || (s.running && !best.running) || (s.running === best.running && laterThan(s.newest, best.newest))) {
          best = { name, ...s };
        }
      }
      const attached = best ? { repo: best.name, ...(best.running && best.adwId ? { adwId: best.adwId } : {}) } : undefined;
      // A pane's runs may span repos (one pane parked above several); newest first across all of them.
      for (const [paneId, runs] of paneRuns) {
        runs.sort((a, b) => (laterThan(a.startedAt, b.startedAt) ? -1 : laterThan(b.startedAt, a.startedAt) ? 1 : 0));
        if (runs.length > PANE_RUNS_CAP) paneRuns.set(paneId, runs.slice(0, PANE_RUNS_CAP));
      }
      // "none" is remembered too, so a workspace with no traces isn't re-scanned every snapshot.
      const state: Found["state"] = repos.length === 0 ? "none" : repos.some((r) => r.dbPath) ? "ready" : "pending";
      found.set(key, { state, repos, attached, paneRuns, fingerprint, at: Date.now() });
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
      const sssf: WorkspaceSssf = {
        state: cur.state,
        token,
        repos: cur.repos.map((r) => ({ name: r.name, state: r.dbPath ? "ready" : "pending", running: r.running })),
        ...(cur.attached ? { attached: cur.attached } : {}),
      };
      return { ...w, sssf };
    });
  }

  function decoratePanes<T extends StampablePane>(panes: T[], session?: string): T[] {
    if (!enabled) return panes;
    return panes.map((p) => {
      const runs = found.get(wsKey(session, p.workspaceId))?.paneRuns.get(p.paneId);
      return runs && runs.length ? { ...p, sssf: { runs } } : p;
    });
  }

  function openDb(dbPath: string): SssfDbApi {
    let db = dbs.get(dbPath);
    if (!db) {
      db = new Db!(dbPath);
      dbs.set(dbPath, db);
    }
    return db;
  }

  /** The db behind `repo` (a name from the snapshot — only ever a Map lookup, never a path); no
   *  `repo` means the attached one. Null when the workspace, the name, or the db isn't there. */
  function dbFor(session: string | undefined, workspaceId: string, repo: string | null): SssfDbApi | null {
    const cur = found.get(wsKey(session, workspaceId));
    if (!cur || !Db) return null;
    const name = repo ?? cur.attached?.repo;
    const hit = name === undefined ? undefined : cur.repos.find((r) => r.name === name);
    if (!hit?.dbPath) return null;
    return openDb(hit.dbPath);
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
    const repo = url.searchParams.get("repo");
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
      const db = workspaceId ? dbFor(session, workspaceId, repo) : null;
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

  return { ready, owns, handle, decorate, decoratePanes, dispose };
}

/** ISO timestamps: compare as instants; fall back to string order for anything unparseable. */
function laterThan(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta > tb;
  return a > b;
}

/** A git worktree root (`.git` file or dir) → candidate, or null when it has nothing SSSF-shaped. */
async function candidateAt(dir: string): Promise<SssfCandidate | null> {
  if (!(await exists(join(dir, ".git")))) return null;
  const db = join(dir, DB_REL);
  if (await exists(db)) return { name: basename(dir), root: dir, dbPath: db };
  if (await exists(join(dir, "adws"))) return { name: basename(dir), root: dir, dbPath: null };
  return null;
}

/**
 * Exported for tests. Every SSSF repo near `cwd`: the nearest worktree root at or above it (up to
 * MAX_WALK levels), plus any worktree root up to MAX_DOWN levels below it. The down-scan reads
 * directory names only, never follows symlinks or junctions, skips dot-dirs and the usual
 * dependency/output folders, and reads at most MAX_DIRENTS entries per directory. Roots are
 * realpath'd so the same repo reached two ways is one candidate.
 */
export async function findRepos(cwd: string): Promise<SssfCandidate[]> {
  const out = new Map<string, SssfCandidate>();
  const add = async (dir: string) => {
    const c = await candidateAt(dir);
    if (!c) return;
    const real = await realpath(c.root).catch(() => c.root);
    if (!out.has(real)) out.set(real, { ...c, root: real, dbPath: c.dbPath && join(real, DB_REL) });
  };
  // Up: the first worktree root wins (a nested checkout is its own repo).
  let dir = resolve(cwd);
  for (let i = 0; i <= MAX_WALK; i++) {
    if (await exists(join(dir, ".git"))) {
      await add(dir);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Down: bounded breadth-first walk from the cwd itself.
  let level = [resolve(cwd)];
  for (let depth = 1; depth <= MAX_DOWN && level.length; depth++) {
    const next: string[] = [];
    for (const d of level) {
      const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
      for (const e of entries.slice(0, MAX_DIRENTS)) {
        // Dirent.isDirectory() is false for symlinks and junctions — they are never entered.
        if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const p = join(d, e.name);
        await add(p);
        next.push(p);
      }
    }
    level = next;
  }
  return [...out.values()];
}

/** Exported for tests: is this a path segment the API accepts as an adw id / agent name? */
export function isSafeSegment(s: string): boolean {
  return SAFE_SEGMENT.test(s);
}
