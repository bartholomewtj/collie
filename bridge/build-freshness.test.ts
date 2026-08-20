import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildFreshness,
  checkBuildFreshness,
  __resetBuildFreshness,
} from "./build-freshness.ts";

// Epoch SECONDS for utimes. Fixed points well apart so no filesystem's mtime granularity (HFS+ is
// whole seconds, some network mounts worse) can blur "older" into "same".
const OLD = 1_700_000_000;
const NEW = 1_700_009_999;

async function stamp(path: string, seconds: number): Promise<void> {
  await utimes(path, seconds, seconds);
}

/** A `web/` tree: dist/build-info.json plus src/main.tsx, each with an explicit mtime. */
async function webTree(opts: {
  builtAt?: number;
  srcAt?: number;
  withDist?: boolean;
  withSrc?: boolean;
}): Promise<string> {
  const { builtAt = OLD, srcAt = OLD, withDist = true, withSrc = true } = opts;
  const root = await mkdtemp(join(tmpdir(), "collie-fresh-"));

  if (withSrc) {
    await mkdir(join(root, "src", "components"), { recursive: true });
    const f = join(root, "src", "components", "app.tsx");
    await writeFile(f, "export const App = () => null;\n");
    await stamp(f, srcAt);
    // The parent directories carry mtimes too; the walk reads FILES only, but pin them anyway so a
    // directory mtime can never be what a passing test is actually measuring.
    await stamp(join(root, "src", "components"), OLD);
    await stamp(join(root, "src"), OLD);
  }
  if (withDist) {
    await mkdir(join(root, "dist"), { recursive: true });
    const f = join(root, "dist", "build-info.json");
    await writeFile(f, JSON.stringify({ version: "0.0.0", id: "test" }));
    await stamp(f, builtAt);
  }
  return root;
}

describe("checkBuildFreshness", () => {
  test("a build newer than its sources is current", async () => {
    const root = await webTree({ srcAt: OLD, builtAt: NEW });
    const r = await checkBuildFreshness(root);
    expect(r.stale).toBe(false);
    expect(r.builtAt).toBeGreaterThan(r.newestSourceAt);
  });

  test("a source newer than the build is stale, and names the file", async () => {
    const root = await webTree({ srcAt: NEW, builtAt: OLD });
    const r = await checkBuildFreshness(root);
    expect(r.stale).toBe(true);
    expect(r.newestSource).toBe("src/components/app.tsx");
  });

  test("a source file added under a fresh build makes it stale", async () => {
    // The real 0.41.1 shape: dist was built, then main moved under it.
    const root = await webTree({ srcAt: OLD, builtAt: OLD });
    expect((await checkBuildFreshness(root)).stale).toBe(false);
    const late = join(root, "src", "late.ts");
    await writeFile(late, "export const x = 1;\n");
    await stamp(late, NEW);
    const r = await checkBuildFreshness(root);
    expect(r.stale).toBe(true);
    expect(r.newestSource).toBe("src/late.ts");
  });

  test("no build at all is not 'stale' — there is nothing to compare", async () => {
    // The static handler already 503s with a build hint for this case; claiming staleness on top
    // would be a second, wronger diagnosis of the same state.
    const root = await webTree({ withDist: false, srcAt: NEW });
    const r = await checkBuildFreshness(root);
    expect(r.stale).toBe(false);
    expect(r.builtAt).toBe(0);
  });

  test("no readable sources is not 'stale' — that is a dist-only deployment", async () => {
    const root = await webTree({ withSrc: false, builtAt: OLD });
    const r = await checkBuildFreshness(root);
    expect(r.stale).toBe(false);
    expect(r.newestSourceAt).toBe(0);
  });

  test("node_modules and dist are never considered sources", async () => {
    // Both are written long after any build — counting either would report stale forever.
    const root = await webTree({ srcAt: OLD, builtAt: OLD });
    for (const d of ["node_modules", "dist"]) {
      const f = join(root, d, "junk.js");
      await mkdir(join(root, d), { recursive: true });
      await writeFile(f, "// generated\n");
      await stamp(f, NEW);
    }
    expect((await checkBuildFreshness(root)).stale).toBe(false);
  });

  test("dot-directories are skipped", async () => {
    const root = await webTree({ srcAt: OLD, builtAt: OLD });
    await mkdir(join(root, "src", ".cache"), { recursive: true });
    const f = join(root, "src", ".cache", "x.js");
    await writeFile(f, "//\n");
    await stamp(f, NEW);
    expect((await checkBuildFreshness(root)).stale).toBe(false);
  });

  test("a top-level source file counts (index.html, vite.config.ts, …)", async () => {
    const root = await webTree({ srcAt: OLD, builtAt: OLD });
    const f = join(root, "index.html");
    await writeFile(f, "<!doctype html>\n");
    await stamp(f, NEW);
    const r = await checkBuildFreshness(root);
    expect(r.stale).toBe(true);
    expect(r.newestSource).toBe("index.html");
  });

  test("a missing web root answers 'not stale' rather than throwing", async () => {
    const r = await checkBuildFreshness(join(tmpdir(), "collie-does-not-exist-9f3a"));
    expect(r.stale).toBe(false);
  });
});

describe("buildFreshness — caching", () => {
  test("reuses the verdict inside the cache window, re-reads after it", async () => {
    __resetBuildFreshness();
    const root = await webTree({ srcAt: OLD, builtAt: NEW });
    expect((await buildFreshness(root, 0)).stale).toBe(false);

    // Touch a source so the truth flips, then ask again inside the window: still the cached answer.
    const late = join(root, "src", "late.ts");
    await writeFile(late, "export const x = 1;\n");
    await stamp(late, NEW + 60);
    expect((await buildFreshness(root, 10_000)).stale).toBe(false);

    // Past the window, the real state surfaces.
    expect((await buildFreshness(root, 40_000)).stale).toBe(true);
    __resetBuildFreshness();
  });
});
