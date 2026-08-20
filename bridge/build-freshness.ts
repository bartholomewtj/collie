// Is the bundle in web/dist older than the sources it was built from?
//
// The bridge serves web/dist FROM DISK, and nothing rebuilds it for you: `git pull` doesn't, a
// branch switch doesn't, editing web/src doesn't. Only `bun run build` (or the ctl's `update`,
// which calls it) does. So a checkout can sit on a correct `main` while the phone serves a bundle
// built from something else entirely — with no error anywhere, because a stale bundle is a
// perfectly valid one. On 2026-08-20 that shipped a frontend from an intermediate commit whose
// routes/detail.tsx dropped a required prop: every pane opened onto "Cannot read properties of
// undefined (reading 'length')" for an hour while main was fine and every test passed.
//
// The check is a plain mtime comparison — newest source vs. the build stamp — deliberately not a
// content hash. A branch switch that rewrites mtimes without changing content will report stale;
// that's the right trade, because the answer ("rebuild") costs seconds and being wrong the other
// way costs an hour.
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Directories under `web/` whose contents feed the build. */
const SOURCE_DIRS = ["src", "public"];
/** Files directly under `web/` that change the output. */
const SOURCE_FILES = ["index.html", "vite.config.ts", "package.json", "tsconfig.json"];
/** Never descend into these — they are output or dependencies, not sources. */
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-staging"]);
/** Depth bound, counted from each source dir. web/src is 3 deep today; 6 leaves room. */
const MAX_DEPTH = 6;
/** Entries read per directory — a runaway-fanout backstop, far above any real tree. */
const MAX_DIRENTS = 500;
/** How long a verdict is reused. Matches the SSSF scan's cache; a rebuild shows within this. */
const CACHE_MS = 30_000;

export interface BuildFreshness {
  /** True when a source file is newer than the build stamp — the bundle needs rebuilding. */
  stale: boolean;
  /** Epoch ms of `web/dist/build-info.json`. 0 when there is no build at all. */
  builtAt: number;
  /** Epoch ms of the newest source file found. 0 when no sources are present. */
  newestSourceAt: number;
  /** Path of that newest source, relative to `web/` — names what to blame in the log. */
  newestSource?: string;
}

/** Newest mtime under `dir`, with the path that carries it. Bounded; unreadable paths are skipped. */
async function newestUnder(
  dir: string,
  rel: string,
  depth: number,
): Promise<{ at: number; path?: string }> {
  if (depth > MAX_DEPTH) return { at: 0 };
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let best = { at: 0, path: undefined as string | undefined };
  for (const e of entries.slice(0, MAX_DIRENTS)) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    // Symlinks are not followed: a link out of the tree is not a source of this build, and
    // following one is how a bounded walk stops being bounded.
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      const sub = await newestUnder(full, childRel, depth + 1);
      if (sub.at > best.at) best = { at: sub.at, path: sub.path };
    } else if (e.isFile()) {
      const s = await stat(full).catch(() => null);
      if (s && s.mtimeMs > best.at) best = { at: s.mtimeMs, path: childRel };
    }
  }
  return best;
}

/**
 * Compare the build stamp against the newest source. `webRoot` is the `web/` directory (the one
 * holding both `src/` and `dist/`), passed in rather than derived so the tests can point at a
 * fixture.
 *
 * Not stale when there is nothing to compare: no `build-info.json` means no build has ever run
 * here (the static handler already 503s with a hint), and no readable sources means this is a
 * dist-only deployment, where the question doesn't apply.
 */
export async function checkBuildFreshness(webRoot: string): Promise<BuildFreshness> {
  const stamp = await stat(join(webRoot, "dist", "build-info.json")).catch(() => null);
  const builtAt = stamp?.mtimeMs ?? 0;

  let newestSourceAt = 0;
  let newestSource: string | undefined;
  const consider = (at: number, path?: string) => {
    if (at > newestSourceAt) {
      newestSourceAt = at;
      newestSource = path;
    }
  };

  for (const d of SOURCE_DIRS) {
    const found = await newestUnder(join(webRoot, d), d, 1);
    consider(found.at, found.path);
  }
  for (const f of SOURCE_FILES) {
    const s = await stat(join(webRoot, f)).catch(() => null);
    if (s) consider(s.mtimeMs, f);
  }

  const comparable = builtAt > 0 && newestSourceAt > 0;
  return { stale: comparable && newestSourceAt > builtAt, builtAt, newestSourceAt, newestSource };
}

// ── Cached wrapper + transition logging ──────────────────────────────────────
//
// The verdict is read on every /api/config, so it caches like buildId() does. The log line fires
// only on a CHANGE, so a box left stale doesn't scroll one warning per poll forever.

let cache: { at: number; value: BuildFreshness } | null = null;
let lastLogged: boolean | null = null;

/** Reset the cache and the logged state. Tests only. */
export function __resetBuildFreshness(): void {
  cache = null;
  lastLogged = null;
}

/**
 * The cached verdict, logging once on each transition. `now` is injectable so tests can age the
 * cache without sleeping.
 */
export async function buildFreshness(
  webRoot: string,
  now: number = Date.now(),
): Promise<BuildFreshness> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  const value = await checkBuildFreshness(webRoot);
  cache = { at: now, value };

  if (lastLogged !== value.stale) {
    if (value.stale) {
      const blame = value.newestSource ? ` (newest: web/${value.newestSource})` : "";
      console.warn(
        `[build] web/dist is OLDER than web/ sources${blame} — the UI being served is not this ` +
          `checkout. Run \`bun run build\`; it is live with no restart.`,
      );
    } else if (lastLogged === true) {
      console.log("[build] web/dist is current again");
    }
    lastLogged = value.stale;
  }
  return value;
}
