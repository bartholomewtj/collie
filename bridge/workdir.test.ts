import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, symlink, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readWorkRoot } from "./config.ts";
import { browserEmbedKind, browserOpenType, createWorkdir, isRefusedName, parseRelPath, PREVIEW_CAP_BYTES, DOWNLOAD_CAP_BYTES } from "./workdir.ts";
import type { Config } from "./config.ts";
import { CAN_SYMLINK } from "./platform-support.ts";

const cfg = (workRoot: string): Config => ({ workRoot, socketPath: "", port: 1, host: "127.0.0.1", allowNonLoopbackBind: false, pollMs: 1, pollIdleMs: 1, notifyDelayMs: 0, readLines: 1, transcript: false, journalRoots: { claude: [], codex: [], pi: [], opencode: [], grok: [] }, submitKeys: [], commandsFile: "", keysFile: "", trustedUser: "", trustedUserOptional: false, auditContent: "none", deviceHeader: "", deviceAllowlist: [], allowedOrigins: [], publicHosts: [], pushAllowedHosts: [], tailscaleHosts: [], allowAnyHost: false, vapidPublic: "", vapidPrivate: "", vapidSubject: "", stateDir: "", multiSession: false, skipServe: false });
const helpers = { guard: () => null, json: (v: unknown, _e: string | null, status = 200) => new Response(JSON.stringify(v), { status }), text: (v: string, status: number) => new Response(v, { status }), failureText: () => "failed", secure: (r: Response) => r, contentTypes: {} };

describe("workdir", () => {
  test("parses roots and refuses unsafe names", () => {
    expect(readWorkRoot({ COLLIE_WORK_ROOT: " " })).toBe("");
    expect(readWorkRoot({ COLLIE_WORK_ROOT: "rel/dir" })).toBe(resolve("rel/dir"));
    for (const n of [".env", ".git", "node_modules", "config", "server.pem", "id_rsa", "__pycache__"]) expect(isRefusedName(n)).toBe(true);
    expect(parseRelPath("a/../b")).toBeNull();
    expect(parseRelPath("C:\\x")).toBeNull();
    expect(parseRelPath("a//b")).toBeNull();
    expect(parseRelPath("a/b")).toEqual(["a", "b"]);
  });
  test("lists safely, previews text, and hides typed refusals", async () => {
    const root = await mkdtemp(join(tmpdir(), "collie-workdir-"));
    try {
      await mkdir(join(root, "sub")); await mkdir(join(root, "node_modules")); await mkdir(join(root, "config"));
      await writeFile(join(root, "a.txt"), "hello"); await writeFile(join(root, ".env"), "secret");
      const w = createWorkdir(cfg(root), helpers);
      const listing = JSON.parse(await (await w.handle(new Request("http://x/api/files"), new URL("http://x/api/files"))).text());
      expect(listing.entries.map((e: { name: string }) => e.name)).toEqual(["sub", "a.txt"]);
      const hidden = await w.handle(new Request("http://x/api/files?path=.env"), new URL("http://x/api/files?path=.env"));
      expect(hidden.status).toBe(404);
      const hiddenNode = await w.handle(new Request("http://x/api/files?path=node_modules/pkg/index.js"), new URL("http://x/api/files?path=node_modules/pkg/index.js"));
      expect(hiddenNode.status).toBe(404);
      const file = await w.handle(new Request("http://x/api/files?path=a.txt"), new URL("http://x/api/files?path=a.txt"));
      expect((await file.json()).text).toBe("hello");
      expect(PREVIEW_CAP_BYTES).toBe(512 * 1024);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test("searches names, caps previews, and downloads safely", async () => {
    const root = await mkdtemp(join(tmpdir(), "collie-workdir-search-"));
    try {
      await mkdir(join(root, "node_modules")); await writeFile(join(root, "Alpha.txt"), "A".repeat(PREVIEW_CAP_BYTES + 1)); await writeFile(join(root, "binary.bin"), new Uint8Array([0, 1])); await writeFile(join(root, "node_modules", "Alpha.txt"), "hidden");
      const w = createWorkdir(cfg(root), helpers);
      const s = await (await w.handle(new Request("http://x/api/files/search?q=alpha"), new URL("http://x/api/files/search?q=alpha"))).json(); expect(s.results).toHaveLength(1);
      const short = await (await w.handle(new Request("http://x/api/files/search?q=a"), new URL("http://x/api/files/search?q=a"))).json(); expect(short.results).toEqual([]);
      const big = await (await w.handle(new Request("http://x/api/files?path=Alpha.txt"), new URL("http://x/api/files?path=Alpha.txt"))).json(); expect(big.truncated).toBe(true); expect(big.text.length).toBe(PREVIEW_CAP_BYTES);
      const bin = await (await w.handle(new Request("http://x/api/files?path=binary.bin"), new URL("http://x/api/files?path=binary.bin"))).json(); expect(bin.binary).toBe(true); expect(bin.text).toBeUndefined();
      const dl = await w.handle(new Request("http://x/api/files/download?path=Alpha.txt"), new URL("http://x/api/files/download?path=Alpha.txt")); expect(dl.headers.get("content-disposition")).toContain("attachment"); expect(dl.headers.get("content-length")).toBe(String(PREVIEW_CAP_BYTES + 1));
      expect(DOWNLOAD_CAP_BYTES).toBe(100 * 1024 * 1024);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("searches caps results and refuses downloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "collie-workdir-cap-"));
    try {
      for (let i = 0; i < 201; i++) await writeFile(join(root, `match-${i}.txt`), "x");
      const w = createWorkdir(cfg(root), helpers);
      const capped = await (await w.handle(new Request("http://x/api/files/search?q=match"), new URL("http://x/api/files/search?q=match"))).json();
      expect(capped.results).toHaveLength(200); expect(capped.truncated).toBe(true);
      await writeFile(join(root, "large.bin"), "x"); await truncate(join(root, "large.bin"), DOWNLOAD_CAP_BYTES + 1);
      const large = await w.handle(new Request("http://x/api/files/download?path=large.bin"), new URL("http://x/api/files/download?path=large.bin")); expect(large.status).toBe(413);
      const refused = await w.handle(new Request("http://x/api/files/download?path=config/x"), new URL("http://x/api/files/download?path=config/x")); expect(refused.status).toBe(404);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects symlinks outside the root", async () => {
    if (!CAN_SYMLINK) return;
    const root = await mkdtemp(join(tmpdir(), "collie-workdir-link-")); const outside = await mkdtemp(join(tmpdir(), "collie-workdir-out-"));
    try { await writeFile(join(outside, "secret.txt"), "outside-secret"); await symlink(join(outside, "secret.txt"), join(root, "link")); const w = createWorkdir(cfg(root), helpers); const response = await w.handle(new Request("http://x/api/files?path=link"), new URL("http://x/api/files?path=link")); expect(response.status).toBe(404); expect(await response.text()).not.toContain("outside-secret"); } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });

  test("calls the read gate", async () => {
    const gated = createWorkdir(cfg("/tmp"), { ...helpers, guard: () => new Response("forbidden", { status: 403 }) });
    expect((await gated.handle(new Request("http://x/api/files"), new URL("http://x/api/files"))).status).toBe(403);
  });

  test("is inert without a root", () => {
    const w = createWorkdir(cfg(""), helpers); expect(w.enabled).toBe(false); expect(w.owns("/api/files")).toBe(false); expect(w.owns("/api/files/search")).toBe(false);
  });

  test("opens allowlisted types inline and refuses scriptable ones", async () => {
    expect(browserOpenType("shot.PNG")).toBe("image/png");
    expect(browserOpenType("notes.md")).toBe("text/plain; charset=utf-8");
    expect(browserOpenType("page.html")).toBeNull();
    expect(browserOpenType("icon.svg")).toBeNull();
    expect(browserOpenType("app.js")).toBeNull();
    const root = await mkdtemp(join(tmpdir(), "collie-workdir-open-"));
    try {
      await writeFile(join(root, "shot.png"), "png-bytes");
      await writeFile(join(root, "page.html"), "<script>alert(1)</script>");
      await writeFile(join(root, "notes.txt"), "hello");
      const w = createWorkdir(cfg(root), helpers);
      const png = await w.handle(new Request("http://x/api/files/open?path=shot.png"), new URL("http://x/api/files/open?path=shot.png"));
      expect(png.status).toBe(200);
      expect(png.headers.get("content-disposition")).toContain("inline");
      expect(png.headers.get("content-type")).toBe("image/png");
      expect(png.headers.get("x-content-type-options")).toBe("nosniff");
      const listed = await (await w.handle(new Request("http://x/api/files?path=shot.png"), new URL("http://x/api/files?path=shot.png"))).json();
      expect(listed.openInBrowser).toBe(true);
      expect(listed.embed).toBe("image");
      const html = await w.handle(new Request("http://x/api/files/open?path=page.html"), new URL("http://x/api/files/open?path=page.html"));
      expect(html.status).toBe(404);
      expect(await html.text()).not.toContain("alert");
      const htmlMeta = await (await w.handle(new Request("http://x/api/files?path=page.html"), new URL("http://x/api/files?path=page.html"))).json();
      expect(htmlMeta.openInBrowser).toBe(false);
      expect(htmlMeta.embed).toBeUndefined();
      const txt = await w.handle(new Request("http://x/api/files/open?path=notes.txt"), new URL("http://x/api/files/open?path=notes.txt"));
      expect(txt.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      const dl = await w.handle(new Request("http://x/api/files/download?path=page.html"), new URL("http://x/api/files/download?path=page.html"));
      expect(dl.status).toBe(200);
      expect(dl.headers.get("content-disposition")).toContain("attachment");
      await writeFile(join(root, "clip.mp4"), "mp4");
      await writeFile(join(root, "track.mp3"), "mp3");
      await writeFile(join(root, "doc.pdf"), "%PDF");
      expect(browserEmbedKind("shot.png")).toBe("image");
      expect(browserEmbedKind("clip.mp4")).toBe("video");
      expect(browserEmbedKind("track.mp3")).toBe("audio");
      expect(browserEmbedKind("doc.pdf")).toBeUndefined();
      expect(browserEmbedKind("notes.txt")).toBeUndefined();
      const mp4 = await (await w.handle(new Request("http://x/api/files?path=clip.mp4"), new URL("http://x/api/files?path=clip.mp4"))).json();
      expect(mp4.embed).toBe("video");
      const mp3 = await (await w.handle(new Request("http://x/api/files?path=track.mp3"), new URL("http://x/api/files?path=track.mp3"))).json();
      expect(mp3.embed).toBe("audio");
      const pdf = await (await w.handle(new Request("http://x/api/files?path=doc.pdf"), new URL("http://x/api/files?path=doc.pdf"))).json();
      expect(pdf.openInBrowser).toBe(true);
      expect(pdf.embed).toBeUndefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
