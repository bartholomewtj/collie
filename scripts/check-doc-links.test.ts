import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The gate this exercises reported broken links and then exited 0 (#66), so the ✓ everyone actually
// reads was a lie. It failed ONLY on realistic input: `done | grep -q fail && fail=1` short-circuits
// on the first match and closes the pipe, the still-writing producer takes SIGPIPE, and `pipefail`
// turns the matched pipeline into a failed one — so a doc with a single dead link exited 1 (the
// producer had already finished) while a doc with several exited 0. Both shapes are pinned below;
// the one-link case is the one that would have passed even before the fix, and it is here so a
// future rewrite can't "fix" the multi-link case by breaking the simple one.

const SCRIPT = join(import.meta.dir, "check-doc-links.sh");

const GIT_BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
];

/**
 * The bash to run the script with. On win32 PATH's first `bash` is the System32 WSL stub — with
 * no distro installed every spawn dies with `execvpe(/bin/bash) failed: No such file or directory`
 * (#66). Prefer Git bash's well-known locations; if none exists, skip rather than invoke the stub.
 */
function resolveBash(): string | null {
  if (process.platform !== "win32") return "bash";
  for (const p of GIT_BASH_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

const BASH = resolveBash();

async function docWith(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "collie-doclinks-"));
  const file = join(dir, "doc.md");
  await writeFile(file, body);
  return file;
}

/** Run the gate over one doc; returns its exit code and both streams. */
async function check(file: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([BASH!, SCRIPT, file], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

describe.skipIf(BASH === null)("check-doc-links.sh", () => {
  test("passes a doc whose links all resolve", async () => {
    // A link to the script itself, which necessarily exists.
    const file = await docWith(`# Doc\n\nSee [it](${SCRIPT}).\n`);
    const r = await check(file);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("✓ doc links resolve");
  });

  test("fails on a single broken link", async () => {
    const file = await docWith("# Doc\n\nSee [nope](./nowhere.md).\n");
    const r = await check(file);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("nowhere.md");
  });

  test("fails on SEVERAL broken links — the #66 shape", async () => {
    // Three dead links keep the producer writing past `grep -q`'s exit. This exact shape printed
    // its failures, printed ✓, and exited 0.
    const file = await docWith(
      "# Doc\n\n" +
        "- [a](./gone-a.md)\n" +
        "- [b](./gone-b.md)\n" +
        "- [c](./gone-c.md)\n",
    );
    const r = await check(file);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("gone-a.md");
    expect(r.stderr).toContain("gone-c.md");
  });

  test("a doc that mixes resolving and broken links still fails", async () => {
    // The real regression: AGENTS.md had one good link and two dead ones, and sailed through.
    const file = await docWith(
      `# Doc\n\nGood: [it](${SCRIPT})\n\nBad: [x](../../nope/CLAUDE.md) and [y](../../nope/IDENTITY.md)\n`,
    );
    const r = await check(file);
    expect(r.code).toBe(1);
  });

  test("never prints the success line on a failing run", async () => {
    // Printing both is what made the gate worse than no gate: the ✓ is what gets read.
    const file = await docWith("# Doc\n\n[a](./gone-a.md) [b](./gone-b.md) [c](./gone-c.md)\n");
    const r = await check(file);
    expect(r.stdout).not.toContain("✓");
  });

  test("ignores http, mailto and anchor links", async () => {
    const file = await docWith(
      "# Doc\n\n[web](https://example.com/nope) [mail](mailto:a@b.c) [anchor](#section)\n",
    );
    const r = await check(file);
    expect(r.code).toBe(0);
  });
});
