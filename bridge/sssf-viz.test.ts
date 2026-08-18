import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "./config.ts";
import {
  cacheControlFor,
  checkAccess,
  deviceAuth,
  failureText,
  isHostAllowed,
  requireJsonBody,
  resolveStaticPath,
} from "./server.ts";
import { createSssfViz, isSafeSegment, readVizDir, type SssfHelpers } from "./sssf-viz.ts";
import type { WorkspaceView } from "./types.ts";

// The pure bits run everywhere. The integration half imports the REAL visualiser db.ts and reads a
// REAL trace db, so it runs only where both exist: SSSF_VIZ_DIR set (the visualiser folder) and
// SSSF_TEST_REPO set (a git checkout with adws/adw_data/sssf.db). That is exactly the "a skill update
// changed db.ts" tripwire the module's startup contract check exists for — run it after re-installing
// the sssf skill:
//   SSSF_VIZ_DIR=~/.claude/skills/sssf/apps/visualizer SSSF_TEST_REPO=~/Projects/claudeSSSF bun test bridge/sssf-viz.test.ts

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    socketPath: "/tmp/herdr.sock",
    port: 8787,
    host: "127.0.0.1",
    allowNonLoopbackBind: false,
    pollMs: 1500,
    pollIdleMs: 12_000,
    notifyDelayMs: 30_000,
    readLines: 200,
    transcript: true,
    journalRoots: { claude: [], codex: [], pi: [], opencode: [], grok: [] },
    submitKeys: ["Enter"],
    commandsFile: "/nope/commands.toml",
    trustedUser: "",
    trustedUserOptional: false,
    auditContent: "preview",
    deviceHeader: "",
    deviceAllowlist: [],
    allowedOrigins: [],
    publicHosts: [],
    pushAllowedHosts: [],
    tailscaleHosts: [],
    allowAnyHost: false,
    vapidPublic: "",
    vapidPrivate: "",
    vapidSubject: "mailto:admin@example.com",
    stateDir: "/tmp/state",
    multiSession: true,
    skipServe: false,
    ...overrides,
  };
}

// The same helpers server.ts hands the module, minus the two module-private ones (secure, CSP),
// which are stand-ins here.
const helpers: SssfHelpers = {
  guard: (req, c, level) => {
    const gate = checkAccess(req, c, level);
    if (!gate.ok) return new Response(gate.reason, { status: 403 });
    if (level === "write" && !deviceAuth(req, c).authorized) return new Response("device", { status: 403 });
    return null;
  },
  isHostAllowed,
  requireJsonBody,
  failureText,
  resolveStaticPath,
  cacheControlFor,
  secure: (r) => r,
  csp: "default-src 'self'; frame-ancestors 'none'",
  contentTypes: { ".html": "text/html" },
};

const ws = (id: string): WorkspaceView => ({
  workspaceId: id,
  number: 1,
  label: id,
  focused: false,
  activeTabId: "t1",
  tabCount: 1,
  paneCount: 1,
});

describe("sssf-viz — pure bits", () => {
  test("isSafeSegment accepts ids and agent names, refuses traversal and empties", () => {
    expect(isSafeSegment("e7b38c61")).toBe(true);
    expect(isSafeSegment("planner")).toBe(true);
    expect(isSafeSegment("a.b-c_d")).toBe(true);
    expect(isSafeSegment("")).toBe(false);
    expect(isSafeSegment("..")).toBe(false);
    expect(isSafeSegment(".")).toBe(false);
    expect(isSafeSegment("...")).toBe(true); // three dots is an odd but harmless file name
    expect(isSafeSegment("a/b")).toBe(false);
    expect(isSafeSegment("a\\b")).toBe(false);
    expect(isSafeSegment("x".repeat(129))).toBe(false);
  });

  test("readVizDir: unset → '', ~ expands, relative becomes absolute", () => {
    expect(readVizDir({})).toBe("");
    expect(readVizDir({ SSSF_VIZ_DIR: "  " })).toBe("");
    expect(readVizDir({ SSSF_VIZ_DIR: "~/x" })).not.toContain("~");
    expect(readVizDir({ SSSF_VIZ_DIR: "rel/dir" })).not.toBe("rel/dir");
  });

  test("feature off: owns() is false and decorate() is the identity", async () => {
    const viz = createSssfViz(cfg(), helpers, { vizDir: "", build: false });
    expect(await viz.ready).toBe(false);
    expect(viz.owns("/sssf")).toBe(false);
    expect(viz.owns("/sssf/api/sessions")).toBe(false);
    const list = [ws("w1")];
    expect(viz.decorate(list, [{ workspaceId: "w1", cwd: "/tmp" }])).toBe(list);
  });

  test("a folder that is not the visualiser disables the feature loudly, not fatally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "not-viz-"));
    const viz = createSssfViz(cfg(), helpers, { vizDir: dir, build: false });
    expect(await viz.ready).toBe(false);
    // owns() is still true (the operator asked for the mount) but every request is a 404 — after the
    // host check.
    expect(viz.owns("/sssf/")).toBe(true);
    const r = await viz.handle(
      new Request("http://127.0.0.1/sssf/", { headers: { host: "127.0.0.1" } }),
      new URL("http://127.0.0.1/sssf/"),
    );
    expect(r.status).toBe(404);
    const evil = await viz.handle(
      new Request("http://evil.example/sssf/", { headers: { host: "evil.example" } }),
      new URL("http://evil.example/sssf/"),
    );
    expect(evil.status).toBe(403);
  });
});

const VIZ = readVizDir();
const REPO = process.env.SSSF_TEST_REPO ?? "";

describe.skipIf(!VIZ || !REPO)("sssf-viz — against the real visualiser db.ts and a real trace db", () => {
  async function boot() {
    const state = await mkdtemp(join(tmpdir(), "sssf-state-"));
    const viz = createSssfViz(cfg({ stateDir: state }), helpers, { vizDir: VIZ, build: false });
    expect(await viz.ready).toBe(true);
    // Discovery is async and fires from decorate(); poll until the workspace is stamped.
    const panes = [{ workspaceId: "w1", cwd: join(REPO, "adws") }, { workspaceId: "w2", cwd: tmpdir() }];
    let stamped: WorkspaceView[] = [];
    for (let i = 0; i < 50; i++) {
      stamped = viz.decorate([ws("w1"), ws("w2")], panes, "primary");
      if (stamped[0]?.sssf) break;
      await Bun.sleep(20);
    }
    return { viz, stamped };
  }

  const get = (viz: Awaited<ReturnType<typeof boot>>["viz"], path: string, headers: Record<string, string> = {}) => {
    const url = new URL(`http://127.0.0.1:8787${path}`);
    return viz.handle(new Request(url, { headers: { host: "127.0.0.1:8787", ...headers } }), url);
  };

  test("stamps the workspace whose pane cwd sits inside the repo; leaves the other alone", async () => {
    const { stamped } = await boot();
    expect(stamped[0]?.sssf?.state).toBe("ready");
    expect(stamped[0]?.sssf?.token).toMatch(/^[0-9a-f]{48}$/);
    expect(stamped[1]?.sssf).toBeUndefined();
  });

  test("reads sessions and detail; health carries no filesystem path", async () => {
    const { viz } = await boot();
    const list = await get(viz, "/sssf/api/sessions?ws=w1&session=primary");
    expect(list.status).toBe(200);
    const sessions = (await list.json()) as Array<{ adw_id: string }>;
    expect(Array.isArray(sessions)).toBe(true);
    const health = (await (await get(viz, "/sssf/api/health?ws=w1&session=primary")).json()) as Record<string, unknown>;
    expect(health.ok).toBe(true);
    expect(health).not.toHaveProperty("db");
    if (sessions[0]) {
      const detail = await get(viz, `/sssf/api/sessions/${sessions[0].adw_id}?ws=w1&session=primary`);
      expect(detail.status).toBe(200);
      const events = await get(viz, `/sssf/api/sessions/${sessions[0].adw_id}/events?ws=w1&session=primary&after=0&limit=5`);
      expect(events.status).toBe(200);
    }
  });

  test("an unknown workspace, a bad segment, and a missing ws are refused", async () => {
    const { viz } = await boot();
    expect((await get(viz, "/sssf/api/sessions?ws=nope&session=primary")).status).toBe(404);
    expect((await get(viz, "/sssf/api/sessions")).status).toBe(404);
    expect((await get(viz, "/sssf/api/sessions/..%2F..%2Fetc/events?ws=w1&session=primary")).status).toBe(400);
    expect((await get(viz, "/sssf/api/sessions/x/agents/..%2F/prompts?ws=w1&session=primary")).status).toBe(400);
  });

  test("Origin: null is a bad origin without the token, and CORS-answered with it (reads only)", async () => {
    const { viz, stamped } = await boot();
    const token = stamped[0]!.sssf!.token;
    const noToken = await get(viz, "/sssf/api/sessions?ws=w1&session=primary", { origin: "null" });
    expect(noToken.status).toBe(403);
    const wrong = await get(viz, `/sssf/api/sessions?ws=w1&session=primary&t=${"0".repeat(48)}`, { origin: "null" });
    expect(wrong.status).toBe(403);
    const ok = await get(viz, `/sssf/api/sessions?ws=w1&session=primary&t=${token}`, { origin: "null" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("null");
    expect(ok.headers.get("vary")).toBe("Origin");
    // A write with Origin: null never gets the pass, token or not.
    const url = new URL(`http://127.0.0.1:8787/sssf/api/sessions/x/archive?ws=w1&session=primary&t=${token}`);
    const post = await viz.handle(
      new Request(url, {
        method: "POST",
        headers: { host: "127.0.0.1:8787", origin: "null", "content-type": "application/json" },
        body: "{}",
      }),
      url,
    );
    expect(post.status).toBe(403);
  });

  test("prompts: absent files read as null; a symlink out of the sessions dir reads as null", async () => {
    const { viz } = await boot();
    const list = (await (await get(viz, "/sssf/api/sessions?ws=w1&session=primary")).json()) as Array<{ adw_id: string }>;
    if (!list[0]) return;
    const r = await get(viz, `/sssf/api/sessions/${list[0].adw_id}/agents/no-such-agent/prompts?ws=w1&session=primary`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ system: null, user: null });
  });

  test("with transcripts off, prompts are always null", async () => {
    const state = await mkdtemp(join(tmpdir(), "sssf-state-"));
    const viz = createSssfViz(cfg({ stateDir: state, transcript: false }), helpers, { vizDir: VIZ, build: false });
    expect(await viz.ready).toBe(true);
    let stamped: WorkspaceView[] = [];
    for (let i = 0; i < 50; i++) {
      stamped = viz.decorate([ws("w1")], [{ workspaceId: "w1", cwd: REPO }], "primary");
      if (stamped[0]?.sssf) break;
      await Bun.sleep(20);
    }
    const list = (await (await get(viz, "/sssf/api/sessions?ws=w1&session=primary")).json()) as Array<{ adw_id: string }>;
    if (!list[0]) return;
    const r = await get(viz, `/sssf/api/sessions/${list[0].adw_id}/agents/planner/prompts?ws=w1&session=primary`);
    expect(await r.json()).toEqual({ system: null, user: null });
  });

  test("a worktree root with adws/ but no db is 'pending'; no .git above the cwd is nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "sssf-pending-"));
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "adws"));
    await writeFile(join(root, "adws", "README"), "");
    const state = await mkdtemp(join(tmpdir(), "sssf-state-"));
    const viz = createSssfViz(cfg({ stateDir: state }), helpers, { vizDir: VIZ, build: false });
    await viz.ready;
    let stamped: WorkspaceView[] = [];
    for (let i = 0; i < 50; i++) {
      stamped = viz.decorate([ws("w1"), ws("w2")], [
        { workspaceId: "w1", cwd: join(root, "adws") },
        { workspaceId: "w2", cwd: tmpdir() },
      ]);
      if (stamped[0]?.sssf) break;
      await Bun.sleep(20);
    }
    expect(stamped[0]?.sssf?.state).toBe("pending");
    expect(stamped[1]?.sssf).toBeUndefined();
  });
});
