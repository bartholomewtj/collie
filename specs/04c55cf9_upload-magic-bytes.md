# Plan — upload MIME allow-list bypassed via prototype keys; no magic-byte check; file mode (issue #9)

## What's wrong

`bridge/server.ts` decides what an uploaded file *is* from a string the client wrote, and looks that
string up in a bare object literal.

```ts
// server.ts:51-56
const IMAGE_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
};
// server.ts:1137-1140
const ext = IMAGE_EXT[file.type];
if (!ext) return json({ ok: false, error: `unsupported type: ${file.type || "unknown"}` }, ae);
```

Four defects, in descending order of how much they matter:

| # | Defect | Where | Effect |
|---|---|---|---|
| 1 | **The allow-list is a bare-object lookup.** `file.type` is the multipart part's `Content-Type` — client-controlled. `IMAGE_EXT["__proto__"]` is `Object.prototype` (truthy); `IMAGE_EXT["constructor"]` is `Object`; `IMAGE_EXT["toString"]` is a function. | `server.ts:1137` | `Content-Type: __proto__` passes the check and `ext` stringifies into the filename: the file lands as `pane-…-abcd1234.[object Object]`. |
| 2 | **Nothing looks at the bytes.** "Validated by MIME" (`server.ts:1102`) means "validated by the client's *claim* about the MIME". | `server.ts:1137` | Any content at all — a shell script, an HTML page — is stored as `.png` if the part says `image/png`. |
| 3 | **The file is written at the process umask.** `Bun.write` has no mode option. Confinement rests entirely on the `0700` **directory**, and `mkdir` only applies `mode` to directories it *creates*. | `server.ts:1148,1152` | If `COLLIE_STATE_DIR` points at a dir that already exists with looser perms, every uploaded image is world-readable. |
| 4 | **No aggregate size cap.** Per-file is capped at 10 MB; the total is unbounded until the 48 h TTL sweep runs. | `uploads.ts:10` | ~360 uploads between sweeps fills the disk the bridge, Herdr and the agents share. |

**Severity is genuinely Low, and the plan should not pretend otherwise.** Reaching this endpoint
already requires write-level access, which is remote-shell-equivalent (`CLAUDE.md` → *Security
posture*). Nothing here is an escalation. What it is, is a **check that does not check** — and
`bridge/journal/registry.ts:66` already solved the identical trap in this same codebase:

```ts
return agent !== undefined && Object.hasOwn(registry, agent) ? registry[agent] : undefined;
```

## Decisions already made — do not re-litigate

- **The bytes decide the extension. The declared `Content-Type` is never consulted again.**
  The issue offers `Object.hasOwn(IMAGE_EXT, file.type)` *or* a `Map` as the fix for defect 1, and a
  byte sniff as a separate fix for defect 2. Doing both leaves two allow-lists that can disagree.
  Sniffing alone is **strictly stronger and smaller**: `IMAGE_EXT` is deleted, so there is no lookup
  left to poison and defect 1 dies structurally rather than by a guard someone can drop later. Do
  **not** add a `hasOwn` check to code that no longer indexes by a client string — and do not
  reintroduce the map "for a nicer error message".
- **A declared type that disagrees with the bytes is not an error.** A client that says
  `image/png` and sends a JPEG gets a `.jpg` file and a 200. The declared type carries no
  information we need once the bytes have spoken, so comparing them only adds a failure mode that
  rejects honest uploads from clients with sloppy MIME detection (phone galleries are sloppy).
- **Four formats stay four formats.** PNG, JPEG, GIF, WebP — the same set as today. This issue is
  about enforcing the existing list honestly, not widening it. No AVIF, no HEIC, no SVG (SVG is
  script-bearing markup and must never join this list).
- **The aggregate cap evicts oldest-first; it does not reject.** Uploads are already single-use and
  already TTL-swept (`uploads.ts:4-12`) — "the oldest one goes" is the semantics this directory
  already has. Rejecting instead would break the operator's next upload for up to 48 h with no
  visible cause and no recovery short of deleting files by hand.
- **The cap is a constant, not a config key.** A new `COLLIE_*` env var would be a new operator
  surface, which is a MINOR bump on a fork that must not bump at all (see *Versioning*), and one
  more thing to document, test and support. 200 MB with a 10 MB per-file cap is 20 images.
- **`cfg.stateDir` itself is left alone.** Defect 3 is fixed by writing the *file* at `0600` and by
  re-asserting `0700` on `<stateDir>/uploads` — a directory Collie creates and owns. The state dir
  is a path the **operator** chose and may deliberately share; silently chmod-ing it at startup
  (`index.ts:50`) would be Collie reaching outside what it owns. A `0600` file is unreadable
  regardless of the perms on the directory above it.
- **No ADR.** `.adr/README.md` sets a deliberately high bar and says the argument belongs at the
  line that would change when there is one. Every decision above has exactly such a line. Put the
  reasoning in the code comments specified below and add nothing to `.adr/`.
- **Out of scope:** `audit.record`'s `detail.filename` echoes the client-supplied `file.name`
  unsanitised into `audit.log`. It is JSON-encoded, never used as a path, and the server-generated
  `saved` name sits beside it. Leave it. Don't touch `web/`'s upload path either — `accept="image/*"`
  (`composer.tsx:684`) is a picker hint, not a control.

## What "done" looks like

- `Content-Type: __proto__`, `constructor`, `toString` and `hasOwnProperty` are all rejected as
  "unsupported image type", and no file is written.
- A file whose first bytes are not a PNG/JPEG/GIF/WebP signature is rejected regardless of what the
  part's `Content-Type` claims.
- An accepted upload exists on disk at mode `0600`, inside a dir at `0700`.
- `<stateDir>/uploads` never exceeds 200 MB: the oldest images are evicted to make room.
- `bun test bridge/uploads.test.ts` is **fully green** (it is 4 pass / 3 fail today on Windows —
  see *Change 5b*), and `bun test ./bridge` fails **36**, down from the 39 baseline.
- `bun run build` typechecks both sides clean.

## Scope

**Touch:**

- `bridge/uploads.ts` — the sniff table, the aggregate cap, the eviction runner
- `bridge/uploads.test.ts` — tests for all three, plus a pre-existing Windows path bug in the fake
- `bridge/server.ts` — delete `IMAGE_EXT`, sniff, write at `0600`, re-assert `0700`, make room
- `requests/issue-9-upload-mime.md` (new — the ADW input file is missing; see *Change 6*)

**Do NOT touch:** `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md` — this is
a fork PR (see *Versioning*). Also leave `bridge/index.ts`, `bridge/types.ts`, `web/`, `README.md`,
`ARCHITECTURE.md` and `.adr/` alone: `UploadResponse` already covers the new error shapes, and no
existing documented sentence becomes false.

---

## Change 1 — sniff the bytes (`bridge/uploads.ts`)

`uploads.ts` is already the uploads module and already holds the pure, unit-tested half of this
feature. The sniff belongs here, not in `server.ts`, because `server.ts`'s HTTP handlers cannot be
unit-tested (they need `Bun.serve`) — `CLAUDE.md` → *Tests* asks that new backend logic be pure
enough for `bun test`.

Add at the top of the file, after the existing `SWEEP_INTERVAL_MS`:

```ts
/**
 * How many leading bytes {@link imageExtFromBytes} needs. The longest signature we check is WebP's,
 * which is "RIFF" at 0 plus "WEBP" at 8 — twelve bytes.
 */
export const SNIFF_BYTES = 12;

/**
 * The upload allow-list, keyed by what the file IS rather than by what the client SAID it is.
 *
 * This used to be `IMAGE_EXT[file.type]` in server.ts — a bare-object lookup on the multipart part's
 * Content-Type, which the client writes. `IMAGE_EXT["__proto__"]` is Object.prototype and
 * `IMAGE_EXT["constructor"]` is Object; both are truthy, so both passed the check and stringified
 * into the saved filename (issue #9). Sniffing removes the lookup entirely, so there is no key left
 * to poison — that is why there is no `Object.hasOwn` guard here to go with the fix.
 *
 * The declared Content-Type is deliberately not consulted, not even to cross-check: once the bytes
 * have answered, a disagreement tells us only that the client's MIME detection is sloppy (phone
 * galleries are), and rejecting on it would refuse honest uploads.
 *
 * SVG is absent on purpose and must stay absent — it is script-bearing markup, not a raster image.
 */
const SIGNATURES: { ext: string; bytes: number[]; at: number }[] = [
  { ext: "png", at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }, // \x89PNG\r\n\x1a\n
  { ext: "jpg", at: 0, bytes: [0xff, 0xd8, 0xff] }, //                               SOI + first marker
  { ext: "gif", at: 0, bytes: [0x47, 0x49, 0x46, 0x38] }, //                         "GIF8" (87a/89a)
  { ext: "webp", at: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, //                        "RIFF" …
  { ext: "webp", at: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, //                        … then "WEBP"
];

function matchesAt(head: Uint8Array, at: number, bytes: number[]): boolean {
  if (head.length < at + bytes.length) return false;
  return bytes.every((b, i) => head[at + i] === b);
}

/**
 * The file extension implied by a file's leading bytes, or null if they are not one of the four
 * image formats Collie accepts. Pure — the whole decision, unit-tested.
 *
 * `head` should be the first {@link SNIFF_BYTES} bytes; a shorter buffer simply matches nothing.
 */
export function imageExtFromBytes(head: Uint8Array): string | null {
  // WebP needs both of its rows to match, so require every row carrying a given ext to hold.
  for (const ext of ["png", "jpg", "gif", "webp"]) {
    const rows = SIGNATURES.filter((s) => s.ext === ext);
    if (rows.every((r) => matchesAt(head, r.at, r.bytes))) return ext;
  }
  return null;
}
```

## Change 2 — the aggregate cap (`bridge/uploads.ts`)

Same file, same shape as the existing `filesToPrune` / `sweepUploads` pair: a pure decision plus an
injectable-fs runner.

**2a. Extend `UploadFs` so a stat carries size.** `node:fs`'s `Stats` already has both, so `realFs`
needs no change beyond widening the type:

```ts
/** The slice of node:fs the sweep needs — injectable so the runner is testable with a fake. */
export interface UploadFs {
  readdir(dir: string): Promise<string[]>;
  stat(path: string): Promise<{ mtimeMs: number; size: number }>;
  unlink(path: string): Promise<void>;
}
```

`realFs`'s `stat: (p) => stat(p)` already satisfies this. `sweepUploads` ignores `size` and is
otherwise untouched.

**2b. Add the cap and the pure decision:**

```ts
/**
 * Ceiling on the total size of `<stateDir>/uploads`. Per-file is capped at 10 MB in server.ts, but
 * nothing bounded the sum: ~360 max-size uploads between two TTL sweeps filled the disk that the
 * bridge, Herdr and every agent share (issue #9).
 *
 * Deliberately a constant and not a COLLIE_* env var — a config key is a new operator surface to
 * document, test and support, for a number that 20 max-size images already comfortably clears.
 */
export const MAX_UPLOADS_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * Which existing uploads must go for `incomingBytes` to fit under `capBytes`, oldest first.
 *
 * Eviction rather than rejection: uploads are single-use and already TTL-swept, so "the oldest one
 * goes" is the semantics this directory already has. Refusing the upload instead would break the
 * operator's next image for up to 48 h with no visible cause. Pure — unit-tested.
 */
export function filesToEvict(
  entries: { name: string; mtimeMs: number; size: number }[],
  incomingBytes: number,
  capBytes: number,
): string[] {
  let total = entries.reduce((sum, e) => sum + e.size, 0) + incomingBytes;
  if (total <= capBytes) return [];
  const evict: string[] = [];
  for (const e of [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= capBytes) break;
    evict.push(e.name);
    total -= e.size;
  }
  return evict;
}
```

**2c. Add the runner**, mirroring `sweepUploads`'s best-effort error handling:

```ts
/**
 * Evict oldest uploads until `incomingBytes` fits under the cap. Returns whether it now fits — false
 * means every eviction failed (a permissions problem), and the caller should refuse the upload
 * rather than blow through the cap. Best-effort like sweepUploads: a missing dir is "empty", and a
 * file that vanishes or won't unlink is skipped.
 */
export async function makeRoomForUpload(
  dir: string,
  incomingBytes: number,
  capBytes: number = MAX_UPLOADS_TOTAL_BYTES,
  fs: UploadFs = realFs,
): Promise<boolean> {
  if (incomingBytes > capBytes) return false;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return true; // dir doesn't exist yet — nothing stored, so it fits
  }
  const entries: { name: string; mtimeMs: number; size: number }[] = [];
  for (const name of names) {
    try {
      const s = await fs.stat(join(dir, name));
      entries.push({ name, mtimeMs: s.mtimeMs, size: s.size });
    } catch {
      /* vanished between readdir and stat — skip */
    }
  }
  let freed = 0;
  const wanted = filesToEvict(entries, incomingBytes, capBytes);
  for (const name of wanted) {
    const size = entries.find((e) => e.name === name)?.size ?? 0;
    try {
      await fs.unlink(join(dir, name));
      freed += size;
    } catch {
      /* already gone / unlink failed — it still counts against the cap */
    }
  }
  const stored = entries.reduce((sum, e) => sum + e.size, 0) - freed;
  return stored + incomingBytes <= capBytes;
}
```

## Change 3 — `uploadPane` uses all of it (`bridge/server.ts`)

**3a. Delete `IMAGE_EXT` entirely** (`server.ts:51-56`). Nothing else references it — confirm with
`grep -n IMAGE_EXT bridge/` before and after.

**3b. Widen the imports.** Line 1 is `import { mkdir } from "node:fs/promises";` — make it:

```ts
import { chmod, mkdir, writeFile } from "node:fs/promises";
```

and add, beside the other bridge imports:

```ts
import { imageExtFromBytes, makeRoomForUpload, SNIFF_BYTES } from "./uploads.ts";
```

**3c. Fix the function's doc block** (`server.ts:1100-1102`). "Validated by MIME and size" is the
claim this issue disproves:

```ts
// Save an uploaded image to a host file and return its absolute path. The client then references
// that path in a message; Claude Code / Codex read images by path (the terminal can't take a
// pasted image over the socket). Validated by SIZE and by its MAGIC BYTES — never by the declared
// Content-Type, which the client writes (issue #9). The filename is server-generated.
```

**3d. Replace the body from the type check to the write** (`server.ts:1137-1152`). Note the check
order flips: **size first**, because `arrayBuffer()` copies the whole file and there is no reason to
allocate 10 MB for something we are about to refuse.

```ts
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ ok: false, error: "image too large (max 10 MB)" } satisfies UploadResponse, ae);
  }
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
  try {
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
```

Leave the `audit.record(...)`, the `return json({ ok: true, path: fullPath })` and the outer
`catch` exactly as they are.

Note for the builder: `mode` is masked by the process umask, which can only *remove* bits — the
result is always at most `0600`. This matches the precedent at `bridge/snooze.ts:66`, which already
chose node:fs over `Bun.write` for the same reason.

## Change 4 — the size check that is now dead code

With size checked before the sniff, the pre-buffer `Content-Length` guard at `server.ts:1112-1126`
still earns its place — it refuses before `req.formData()` materialises the body. **Leave it alone.**
Its comment is still accurate. Mentioned here only so it is not "tidied up" in passing.

## Change 5 — tests (`bridge/uploads.test.ts`)

House style, from the existing file: `import { describe, expect, test } from "bun:test"`, a prose
comment above each `describe` block saying why it exists, fake-fs objects built by a local helper.

**5a. Widen the import** to `filesToEvict, filesToPrune, imageExtFromBytes, makeRoomForUpload,
MAX_UPLOADS_TOTAL_BYTES, SNIFF_BYTES, sweepUploads, type UploadFs`.

**5b. Fix the pre-existing Windows bug in `fakeFs` — do this first.** Three of this file's seven
tests fail on Windows today, and they will still fail after your change unless you fix them. The
fake splits paths on `/` (`uploads.test.ts:41,46`) while `join()` emits `\` on Windows, so the name
lookup misses and every entry gets `mtimeMs: undefined`. Change **both** occurrences:

```ts
      const name = p.split(/[\\/]/).pop()!;
```

Correct on both platforms (`"/uploads/old.png"` and `"\uploads\old.png"` both yield `"old.png"`).
Also give the fake a size, since `UploadFs.stat` now requires one — `0` is right here, because the
TTL sweep does not consult it:

```ts
        return Promise.resolve({ mtimeMs: files[name]!, size: 0 });
```

**This is in scope, not scope creep:** you are editing this fake anyway for the type change, the
existing tests cannot otherwise be run to confirm you did not break them, and it takes the
`bun test ./bridge` Windows failure count from 39 to 36. Expect that number to drop — it is the fix
working, not a regression.

**5c. `imageExtFromBytes`.** Build the fixtures from real signature bytes:

```ts
// The upload allow-list used to be a bare-object lookup on the client-declared Content-Type, so
// "__proto__" and "constructor" resolved to truthy Object.prototype members and sailed through
// (issue #9). The extension now comes from the bytes, so these tests pin the whole check.
describe("imageExtFromBytes", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]);

  test("recognises each accepted format", () => {
    expect(imageExtFromBytes(png)).toBe("png");
    expect(imageExtFromBytes(jpg)).toBe("jpg");
    expect(imageExtFromBytes(gif)).toBe("gif");
    expect(imageExtFromBytes(webp)).toBe("webp");
  });

  test("a RIFF container that is not WebP is refused", () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(imageExtFromBytes(wav)).toBeNull();
  });

  // The exact bypass from issue #9: these strings were the client's declared Content-Type, and each
  // one resolved to a truthy Object.prototype member. As BYTES they are just text, like any other
  // non-image payload — which is the point.
  test.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "%s is not an image type",
    (name) => {
      expect(imageExtFromBytes(new TextEncoder().encode(name))).toBeNull();
    },
  );

  test("script content declared as an image is refused", () => {
    expect(imageExtFromBytes(new TextEncoder().encode("#!/bin/sh\necho hi"))).toBeNull();
  });

  test("a buffer shorter than a signature matches nothing", () => {
    expect(imageExtFromBytes(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(imageExtFromBytes(new Uint8Array())).toBeNull();
  });

  test("SNIFF_BYTES is enough for every signature", () => {
    expect(imageExtFromBytes(webp.subarray(0, SNIFF_BYTES))).toBe("webp");
  });
});
```

**5d. `filesToEvict`.** Cover: under the cap evicts nothing; the boundary (total exactly equal to
the cap is *not* over); eviction is oldest-first and stops as soon as it fits; an incoming file
larger than the whole cap; an empty directory.

**5e. `makeRoomForUpload`.** A second fake is needed because the existing one maps name → mtime
only. Add a sibling helper that maps name → `{ mtimeMs, size }` and reuses the same
`split(/[\\/]/)` trick. Cover: fits without eviction (nothing unlinked, returns `true`); evicts the
oldest and returns `true`; a missing dir returns `true`; **every unlink failing returns `false`**
(this is the branch that makes `server.ts` refuse rather than exceed the cap).

## Change 6 — restore the missing request file

`requests/issue-9-upload-mime.md` — the ADW input for this run — does not exist, though issues #1,
#5 and #8 have theirs. Create it from the issue body so the record matches. Get the text with:

```bash
gh issue view 9 --repo bartholomewtj/collie
```

First line `# Issue #9 — Low: upload MIME allow-list bypassed via Object.prototype keys; no
magic-byte check; file mode`, then the `## What` and `## Fix` sections verbatim. Commit it with the
functional change, as `5e94351` did for issue #5.

---

## Verify

Run from the repo root. **Judge every command by its exit status, not by words in its output.**

```bash
bun test bridge/uploads.test.ts    # must be FULLY green — no fails at all
bun test ./bridge                  # whole backend suite
bun run build                      # typechecks BOTH sides, then builds web
```

**Windows baseline, measured on this machine just now:** `bun test ./bridge` is **582 pass / 39
fail** before your change. All 39 are POSIX assumptions (`/srv/...` paths, chmod, unix sockets) —
see `NEXT-SESSION.md:42`. Do not chase them. Your bar:

- `bridge/uploads.test.ts` alone: **0 fails** (it is 4 pass / 3 fail today; *Change 5b* fixes that).
- `bun test ./bridge`: **36 fails**, not 39. A count of 39 means you skipped 5b; anything above 39
  means you broke something.

`web/` is untouched, so `cd web && bun run test` is optional — run it once at the end if you like.

Manual smoke on a Linux host with a bridge running (skip on Windows):

```bash
# a text file declared as an image → refused
printf 'not an image' > /tmp/x.png
curl -s -X POST -F 'file=@/tmp/x.png;type=image/png' http://127.0.0.1:8787/api/pane/PANE/upload
# → {"ok":false,"error":"unsupported image type (expected PNG, JPEG, GIF or WebP)"}

# the prototype-key bypass → refused (was: saved as .[object Object])
curl -s -X POST -F 'file=@/tmp/x.png;type=__proto__' http://127.0.0.1:8787/api/pane/PANE/upload

# a real PNG → accepted, and lands at 0600 inside a 0700 dir
curl -s -X POST -F 'file=@/path/to/real.png' http://127.0.0.1:8787/api/pane/PANE/upload
ls -l "$COLLIE_STATE_DIR/uploads"        # -rw------- on the file
ls -ld "$COLLIE_STATE_DIR/uploads"       # drwx------ on the dir
```

Remember `systemctl --user restart collie` before smoke-testing — Bun does **not** hot-reload the
bridge, and this is entirely a `bridge/` change (`CLAUDE.md` → *Build / run*).

## Versioning — bump nothing

`origin` is `bartholomewtj/collie`, `upstream` is `AltanS/collie`, and `gh repo view` confirms
`isFork: true`. Per `CLAUDE.md` → *Versioning*, a **fork PR leaves all four files alone**: do not
touch `herdr-plugin.toml`, `package.json`, `web/package.json` or `CHANGELOG.md`. All four agree on
`0.29.0` and `scripts/check-version.sh` stays green. Every fork commit so far has done the same.

The pre-commit hook will object because `bridge/` changed. Commit with
`SKIP_VERSION_CHECK=1 git commit …` — the documented escape hatch for exactly this case.

Put the proposed CHANGELOG line in the PR description instead, in the repo's house style:

> **An uploaded image is typed by its bytes, not by what the client says it is** — the MIME
> allow-list was a bare-object lookup, so `Content-Type: __proto__` passed and nothing ever read the
> file; uploads are now written `0600`, the uploads dir's `0700` is re-asserted, and the directory is
> capped at 200 MB with oldest-first eviction (#9)

## Branch, commits and PR

You are already on `fix/9-upload-mime` — stay there. The spec commit is separate, so land the
functional work as one commit:

```
Type uploaded images by their magic bytes and harden upload storage
```

Then `gh pr create` referencing `Fixes #9`. The PR body should say:

1. That the prototype-key bypass is fixed **structurally** — the client-keyed lookup is gone, not
   guarded — and that this is why there is no `Object.hasOwn` in the diff despite the issue naming it.
2. That the declared `Content-Type` is now ignored entirely, including for cross-checking, and why
   (sloppy phone-gallery MIME detection would otherwise refuse honest uploads).
3. The `0600` file mode, and that `cfg.stateDir` is deliberately left alone.
4. The 200 MB cap with oldest-first eviction, and why it evicts rather than rejects.
5. That `bridge/uploads.test.ts`'s fake fs also got a cross-platform path fix, which un-breaks three
   tests that were failing on Windows.
