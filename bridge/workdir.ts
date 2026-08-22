// Read-only work-directory browser (filesystem reader #3). It is opt-in via COLLIE_WORK_ROOT;
// every path is contained after symlink resolution and the client never sees an absolute path.
// Dot names are refused deliberately: a simple fail-closed rule is safer than an allow-list.
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Config } from "./config.ts";
import { containedRealpath } from "./journal/files.ts";
import type { WorkdirEntry, WorkdirFile, WorkdirListing, WorkdirSearchResult } from "./types.ts";

export const MAX_ENTRIES = 2000;
export const PREVIEW_CAP_BYTES = 512 * 1024;
export const DOWNLOAD_CAP_BYTES = 100 * 1024 * 1024;
export const SEARCH_MAX_DEPTH = 8;
export const SEARCH_MAX_RESULTS = 200;
export const SEARCH_MAX_DIRS = 5000;
export const BINARY_SNIFF_BYTES = 8192;

export function isRefusedName(name: string): boolean {
  if (name.startsWith(".")) return true;
  const lower = name.toLowerCase();
  if (["node_modules", "config", "__pycache__", "venv", "target", "vendor", "thumbs.db", "desktop.ini"].includes(lower)) return true;
  return /\.(pem|key|pfx|p12|kdbx|keystore|jks)$/i.test(name) || /^id_(rsa|ecdsa|ed25519)/i.test(name);
}

export function parseRelPath(raw: string): string[] | null {
  if (raw.length > 1024 || /[\u0000-\u001f\\]/.test(raw) || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return null;
  if (raw === "") return [];
  const parts = raw.split("/");
  if (parts.length > 32 || parts.some((p) => !p || p === "." || p === ".." || p.includes(":") || isRefusedName(p))) return null;
  return parts;
}

export async function resolveInRoot(root: string, segs: string[]): Promise<string | null> {
  return containedRealpath(join(root, ...segs), root);
}

export interface WorkdirHelpers {
  guard: (req: Request, cfg: Config, level: "read" | "write") => Response | null;
  json: (data: unknown, encoding: string | null, status?: number) => Response;
  text: (body: string, status: number) => Response;
  failureText: (context: string, err: unknown) => string;
  secure: (res: Response) => Response;
  contentTypes: Record<string, string>;
}

const notFound = (h: WorkdirHelpers) => h.json({ error: "not found" }, null, 404);
function relPath(segs: string[]): string { return segs.join("/"); }

async function inspect(root: string, segs: string[]): Promise<WorkdirListing | WorkdirFile | null> {
  const real = await resolveInRoot(root, segs);
  if (!real) return null;
  const info = await stat(real).catch(() => null);
  if (!info) return null;
  const path = relPath(segs);
  if (info.isDirectory()) {
    const raw = await readdir(real, { withFileTypes: true });
    const eligible = raw.filter((e) => !isRefusedName(e.name) && (e.isDirectory() || e.isFile()));
    const truncated = eligible.length > MAX_ENTRIES;
    eligible.sort((a, b) => Number(!a.isDirectory()) - Number(!b.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const entries: WorkdirEntry[] = [];
    for (const e of eligible.slice(0, MAX_ENTRIES)) {
      const s = await stat(join(real, e.name)).catch(() => null);
      if (s) entries.push(e.isDirectory() ? { name: e.name, kind: "dir", mtimeMs: s.mtimeMs } : { name: e.name, kind: "file", size: s.size, mtimeMs: s.mtimeMs });
    }
    return { kind: "dir", path, entries, truncated };
  }
  if (!info.isFile()) return null;
  const file = Bun.file(real);
  const sniff = new Uint8Array(await file.slice(0, Math.min(info.size, BINARY_SNIFF_BYTES)).arrayBuffer());
  let binary = sniff.includes(0);
  if (!binary) { try { new TextDecoder("utf-8", { fatal: true }).decode(sniff); } catch { binary = true; } }
  if (binary) return { kind: "file", path, name: basename(real), size: info.size, mtimeMs: info.mtimeMs, binary: true };
  return { kind: "file", path, name: basename(real), size: info.size, mtimeMs: info.mtimeMs, text: await file.slice(0, PREVIEW_CAP_BYTES).text(), truncated: info.size > PREVIEW_CAP_BYTES, binary: false };
}

async function search(root: string, q: string): Promise<{ q: string; results: WorkdirSearchResult[]; truncated: boolean }> {
  const results: WorkdirSearchResult[] = []; let truncated = false; let dirs = 0;
  const queue: { path: string[]; depth: number }[] = [{ path: [], depth: 0 }];
  while (queue.length && !truncated) {
    const current = queue.shift()!; dirs++; if (dirs > SEARCH_MAX_DIRS) { truncated = true; break; }
    const real = await resolveInRoot(root, current.path); if (!real) continue;
    const entries = await readdir(real, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (isRefusedName(e.name) || (!e.isDirectory() && !e.isFile())) continue;
      const path = [...current.path, e.name];
      if (e.name.toLowerCase().includes(q.toLowerCase())) { results.push({ path: relPath(path), name: e.name, kind: e.isDirectory() ? "dir" : "file" }); if (results.length >= SEARCH_MAX_RESULTS) { truncated = true; break; } }
      if (e.isDirectory() && current.depth < SEARCH_MAX_DEPTH) queue.push({ path, depth: current.depth + 1 });
    }
  }
  return { q, results, truncated };
}

export function createWorkdir(cfg: Config, h: WorkdirHelpers) {
  const enabled = cfg.workRoot !== "";
  const owns = (pathname: string) => enabled && (pathname === "/api/files" || pathname.startsWith("/api/files/"));
  async function handle(req: Request, url: URL): Promise<Response> {
    const gate = h.guard(req, cfg, "read"); if (gate) return gate;
    if (req.method !== "GET" && req.method !== "HEAD") return h.text("method not allowed", 405);
    try {
      if (url.pathname === "/api/files/search") {
        const q = (url.searchParams.get("q") ?? "").trim();
        return h.json(q.length < 2 ? { q, results: [], truncated: false } : await search(cfg.workRoot, q), req.headers.get("accept-encoding"));
      }
      if (url.pathname === "/api/files/download") {
        const segs = parseRelPath(url.searchParams.get("path") ?? ""); const real = segs && await resolveInRoot(cfg.workRoot, segs);
        if (!real) return notFound(h); const s = await stat(real).catch(() => null);
        if (!s?.isFile()) return notFound(h); if (s.size > DOWNLOAD_CAP_BYTES) return h.text("file too large", 413);
        const name = basename(real); const fallback = name.replace(/[^\x20-\x7e]|["\\\u0000-\u001f]/g, "_");
        return h.secure(new Response(Bun.file(real), { headers: { "content-type": h.contentTypes[extname(real).toLowerCase()] ?? "application/octet-stream", "content-disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`, "content-length": String(s.size), "cache-control": "no-store", "x-content-type-options": "nosniff" } }));
      }
      const segs = parseRelPath(url.searchParams.get("path") ?? ""); if (!segs) return notFound(h);
      const result = await inspect(cfg.workRoot, segs); return result ? h.json(result, req.headers.get("accept-encoding")) : notFound(h);
    } catch (err) { return h.text(h.failureText("files", err), 500); }
  }
  return { enabled, owns, handle };
}
