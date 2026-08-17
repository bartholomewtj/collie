# Plan — frontend/static hardening: build-info bypasses the host allowlist, `//` links, `ctrl+` hint keys (issue #11)

Three unrelated Low-severity items that happen to share a PR. None is an escalation; each is a
**check that doesn't check**. Do them as three separate commits so a reviewer can read them apart.

You are already on branch `fix/11-frontend-static-hardening`. Stay there.

---

## The three defects

### 1. `serveStatic` is the last route with no Host check (`bridge/server.ts`)

`checkAccess` (`server.ts:1223-1234`) fails closed on the Host allowlist as its **first** act:

```ts
const host = req.headers.get("host") ?? "";
// Host-header allowlist — only when the operator opted in (COLLIE_PUBLIC_HOSTS non-empty). Fail
// closed, before the Origin logic, so a rebinding request (Host==Origin==evil) never reaches it.
if (cfg.publicHosts.length > 0 && !isHostAllowed(host, cfg)) {
  return { ok: false, reason: "host not allowed" };
}
```

Every `/api/*` route runs it via `guard()`. The static fallback does not. Dispatch (`server.ts:428-431`):

```ts
if (isReservedAuthPath(pathname)) return reservedAuthPlaceholder();

// ── Static PWA (with SPA fallback) ───────────────────────────────────
return serveStatic(pathname);
```

`serveStatic` (`server.ts:1536`) takes **only `pathname`** — no `Request`, no `Config` — so it has no
Host to check even if it wanted to. A static request passes through nothing but the peer-address gate
at `server.ts:188` (which, under the enforced loopback bind, can never fire).

So with `COLLIE_PUBLIC_HOSTS` set, a rebound DNS name gets 403 from `/api/*` but is still served
`GET /` and, more to the point, `GET /build-info.json` — and every static response carries
`X-Collie-Build` (`server.ts:1559`).

This is **exactly** the hole that was closed for `/api/config` in upstream #32. That fix's comment
(`server.ts:314-321`) names the symptom verbatim: *"this was the one route that skipped `checkAccess`
entirely, so `COLLIE_PUBLIC_HOSTS` didn't cover it and a rebound DNS name could still read the build
id."* It was not the one route. `serveStatic` is the other one.

It also makes a documented sentence false today. `README.md:142-144`:

> set `COLLIE_PUBLIC_HOSTS` to the exact host(s) you serve on … and the bridge rejects any request
> addressed to another Host **before the origin logic runs**

"Any request" is not true of static. **This change makes the README honest rather than requiring a
README edit** — that framing belongs in the PR body.

**A sub-defect you must fix or the build-info denial is bypassable.** `resolveStaticPath`
(`server.ts:1477-1485`) normalises `full` but **not** `rel`:

```ts
const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
const full = normalize(join(webDir, rel));
if (full !== webDir && !full.startsWith(webDir + sep)) return null;
return { rel, full };
```

For `GET /./build-info.json`: `rel` is `"./build-info.json"`, `full` is `<dist>/build-info.json`. The
containment check passes and the file is served — but a denial written as `rel === "build-info.json"`
would **miss it**. Same for `/foo/../build-info.json`. Two existing consumers already read `rel` and
already have this bug in miniature: `if (rel === "sw.js")` (`server.ts:1563`, so `/./sw.js` silently
loses its `Service-Worker-Allowed` header) and `cacheControlFor(rel)` (`server.ts:1560`, so
`/./assets/x.js` gets `no-cache` instead of `immutable`). One normalisation fixes all three.

### 2. `safeHref` allows scheme-relative hrefs (`web/src/lib/markdown.ts:61-68`)

```ts
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href === "") return null;
  // Scheme-relative ("//evil.com") inherits the page scheme and is a real navigation — allow it, it
  // can only ever be http(s) here. A rooted or relative path stays same-origin, which is harmless.
  if (href.startsWith("/") || href.startsWith("#")) return href;
  return SAFE_SCHEME.test(href) ? href : null;
}
```

The comment states the hole and then waves it through. `//evil.tld/login` is not "a rooted path that
stays same-origin" — it is a **navigation to another host** wearing a rooted path's clothes. The
renderer (`web/src/components/markdown-text.tsx:61-73`) gives it `target="_blank"`, so an agent that
emits `[Sign in to continue](//evil.tld/login)` gets a real tab on a real attacker origin.

Phishing surface only — `rel="noopener noreferrer"` is already set and no script runs. But
"it can only ever be http(s)" was never the property that made a link safe.

`/\evil.tld` is the same attack: for special schemes the WHATWG URL parser treats a backslash as a
slash, so browsers resolve it to `//evil.tld`. Reject both.

`web/src/lib/links.ts` (terminal autolinking) is **not** affected — it matches `https?://…` only.
Leave it alone.

### 3. Agent text picks which key a labelled button sends (`web/src/lib/harness/menu-hints.ts:70-71`)

```ts
const ctrl = /^ctrl\+([a-z])$/.exec(lower);
if (ctrl) return `ctrl+${ctrl[1]}`;
```

`menuKeyFor` maps a token parsed out of **pane text** to a key. Both the key and the button's label
come from that same text, so an agent printing `ctrl+c to Continue` produces a button reading
"Continue" that sends `ctrl+c`. Same-pane only — the agent interrupts itself — so severity is Low.

The distinction that matters, and the one to put in the code comment: **the footer's other keys are
in-band; control keys are not.** `Enter`, `s`, `Tab`, `Esc` are consumed by whatever is reading the
terminal — the modal answers them, and the worst case is the wrong answer to the visible question.
`ctrl+c` / `ctrl+d` / `ctrl+z` reach the harness's signal handling regardless of what is on screen:
interrupt, EOF, suspend. They are not answers to the dialog; they act on the **session** hosting it.
ADR 0009 accepted "only keys the screen printed" on the reasoning that a screen naming its own keys
is the one thing about an unknown modal we can trust. That holds for a key the modal will consume.
It does not hold for one that escapes the modal entirely.

`menuKeyFor` is genuinely the only gate — `submitMenuKeys` (`web/src/lib/menu-action.ts:28-47`) does
no key filtering, exactly as the file header at `menu-hints.ts:14` claims.

---

## Decisions already made — do not re-litigate

- **`serveStatic` gets the Host check ONLY — not `guard()`, not `checkAccess`.** `guard()` would also
  impose the Origin rule and the Tailscale identity gate on the app shell. A top-level navigation
  carries no `Origin`, and under `cfg.trustedUser` an identity miss would 403 the entire PWA instead
  of one endpoint. The rebinding hole is a **Host** problem; fix it with the Host predicate. This is
  also what the issue asks for literally.
- **The refusal is a 403 `"host not allowed"`, byte-identical to `checkAccess`'s.** Same reason
  string, same status, so an operator debugging a Host mismatch sees one message from the whole
  bridge rather than two dialects.
- **The Host check runs FIRST in `serveStatic`, before `resolveStaticPath`.** A rebound host must get
  one uniform 403 and learn nothing from path-shaped probing (403 forbidden vs 404 vs 503
  not-built are three distinguishable answers today).
- **`build-info.json` is refused with 404 `"not found"`, not 403.** 403 confirms the file exists. The
  route already returns `text("not found", 404)` for a missing asset; be indistinguishable from that.
- **Dropping `build-info.json` from the static route breaks nothing — verified, don't hedge it.**
  Every reader takes it off **disk**, never over HTTP: `bridge/server.ts:1442`
  (`Bun.file(join(WEB_DIR, "build-info.json"))`, feeding `X-Collie-Build` and `/api/config`),
  `scripts/collie-ctl.sh:288`, `contrib/windows/collie-ctl.ps1:272`. The frontend has four `fetch`
  call sites (`web/src/lib/api.ts:160,243,452`, `web/src/lib/push.ts:152`) and none targets it; it
  learns the server build passively from the `X-Collie-Build` header (`api.ts:6,146`) and from
  `/api/config` (`build-stamp.tsx:27`, `settings.tsx:41`). It is also absent from the SW precache —
  `globPatterns` (`web/vite.config.ts:158`) excludes `.json` deliberately.
- **`resolveStaticPath` must return a NORMALISED `rel`.** Not optional polish: without it the
  build-info denial is bypassed by `/./build-info.json`. Do this in `resolveStaticPath` rather than
  by hardening one call site, because three consumers key off `rel` and all three are wrong today.
- **`safeHref` REJECTS scheme-relative rather than resolving it against the origin.** The issue
  offers both. Rejecting is smaller, needs no `window.location`, and keeps the function pure and
  trivially unit-testable. An unsafe href already renders as literal Markdown text
  (`markdown.ts:114`), so nothing silently disappears — same behaviour `javascript:` already gets.
- **Do NOT add a visual marker to text-parsed menu buttons.** The issue's item 3 suggests it; decline
  it, and say so in the PR body rather than dropping it silently. Three reasons: (a) **every** action
  in `MenuBlock` is screen-derived — `parseKeyHintFooter` is the only `MenuModel` producer in the repo
  (`web/src/lib/harness/claude/menu.ts:75`), so a marker would mark 100% of buttons and carry no
  information; (b) the provenance is **already visual and by design** — `MenuBlock` mirrors the raw
  terminal region verbatim directly above the buttons, and its header comment
  (`menu-block.tsx:39-43`) says that is the whole point, so the user can see the footer the buttons
  came from; (c) a badge rendered as visible text inside the button breaks the accessible-name
  assertions in `menu-block.test.tsx:34-40`. Adding a provenance field to `MenuAction` with exactly
  one possible value is dead weight. Revisit only if an adapter ever mixes screen-derived and
  Collie-synthesised actions in one `MenuModel`.
- **Do NOT touch the operator's Ctrl-C.** `web/src/components/nav-tray.tsx:50-55,235` hardcodes
  `ctrl+c/d/u/r/l/z` presets, and `web/src/lib/key-queue.ts` composes operator-armed chords. Neither
  goes through `menuKeyFor`. Zero overlap — verified.
- **Do NOT touch `isValidHerdrKey`.** `conformance.test.ts:107-109` asserts `ctrl+c`, `ctrl+k`,
  `ctrl+left` are valid **Herdr wire** keys, a deliberately broader whitelist that
  `preview-action.ts` depends on. The ban belongs in `menuKeyFor`, not the key validator — same
  structure ADR 0009 chose for digits.
- **Write ADR 0013.** This narrows an accepted ADR's Decision sentence, which is the one case the
  `.adr/README.md` bar is unambiguously met by: the other road was not merely arguable, it was
  *accepted and shipped* (`menu-hints.ts:51` lists `ctrl+<letter>` in the whitelist). A diff that
  silently contradicts an ADR is worse than one more file. Fork-PR precedent exists: commit `4219f4f`
  on this branch lineage added `.adr/0012`. Keep it short.
- **Bump nothing.** See *Versioning* below.

---

## What "done" looks like

- With `COLLIE_PUBLIC_HOSTS=collie.example.com`, `GET /` and `GET /assets/x.js` with
  `Host: evil.tld` return **403 `host not allowed`** — same as `/api/*` does today.
- With `COLLIE_PUBLIC_HOSTS` unset (the default), static serving is byte-for-byte unchanged.
- `GET /build-info.json`, `GET /./build-info.json` and `GET /a/../build-info.json` all return
  **404 `not found`** from an allowed host. `X-Collie-Build` still travels on every other static
  response, and `/api/config` still reports the build id.
- `resolveStaticPath("/./assets/app.js").rel === "assets/app.js"`.
- `safeHref("//evil.tld/login")`, `safeHref("/\\evil.tld")` → `null`; `safeHref("/pane/w1:p1")` and
  `safeHref("#section")` still return themselves.
- `menuKeyFor("ctrl+g")` → `null`. No menu fixture's expected actions change.
- `cd web && bun run test` — **108 files, 2269 pass, 0 fail** (plus your new cases).
- `bun test ./bridge` — **36 fail**, unchanged from baseline. Not 38. See *Verify*.
- `bun run build` typechecks both sides clean.

---

## Scope

**Touch:**

| File | Why |
|---|---|
| `bridge/server.ts` | Host gate on `serveStatic`; normalise `rel`; deny `build-info.json` |
| `bridge/server.test.ts` | New cases; drop `build-info.json` from the `cacheControlFor` served list |
| `web/src/lib/markdown.ts` | `safeHref` rejects scheme-relative |
| `web/src/lib/markdown.test.ts` | `//` and `/\` cases |
| `web/src/lib/harness/menu-hints.ts` | Delete the `ctrl+` branch + fix the doc comment at line 51 |
| `web/src/lib/harness/menu-hints.test.ts` | Move `ctrl+g` from the maps-to list to the null list |
| `HARNESS_CONTRIBUTING.md` | The adapter contract list (~line 100) |
| `.adr/0013-…md` (new) | The ctrl narrowing |
| `.adr/0009-…md` | One-line status pointer only |
| `requests/issue-11-frontend-static-hardening.md` (new) | The ADW input file is missing |

**Do NOT touch:** `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md` (fork PR —
see *Versioning*). Also leave alone: `README.md` (the fix makes `:142` true, no edit needed),
`ARCHITECTURE.md`, `web/src/lib/links.ts`, `web/src/components/menu-block.tsx`,
`web/src/lib/harness/menu-model.ts`, `web/src/components/nav-tray.tsx`, `web/src/lib/key-queue.ts`,
`web/src/lib/harness/conformance.ts`, `web/vite.config.ts`, and every fixture under
`web/src/fixtures/panes/`.

---

## Commit 1 — the static route (`bridge/server.ts`)

### 1a. Import `relative`

`server.ts:3` is `import { extname, join, normalize, sep } from "node:path";` — add `relative`:

```ts
import { extname, join, normalize, relative, sep } from "node:path";
```

### 1b. Normalise `rel` in `resolveStaticPath` (`server.ts:1477-1485`)

Replace the body:

```ts
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
```

Keep the existing doc comment above it; it is still accurate.

### 1c. The private-file denial

Add next to `cacheControlFor` (after `server.ts:1579`):

```ts
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
```

### 1d. `serveStatic` takes the Host and the config (`server.ts:1536`)

New signature and first three statements. Everything from `let file = Bun.file(full);` down is
**unchanged**:

```ts
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
  // … rest unchanged …
```

### 1e. The call site (`server.ts:431`)

```ts
      // ── Static PWA (with SPA fallback) ───────────────────────────────────
      return serveStatic(pathname, req.headers.get("host") ?? "", cfg);
```

`?? ""` matches `checkAccess:1228`, and `isHostAllowed` returns `false` for `""` — fail closed.

### 1f. The now-false comment on `cacheControlFor` (`server.ts:1567-1576`)

The doc block lists `build-info.json` among files that are "MUTABLE across a rebuild and must always
be revalidated". It is no longer served at all. Drop it from that sentence:

```
 * `assets/` are content-addressed, so cache them hard + immutable. EVERYTHING else — index.html,
 * sw.js, manifest.webmanifest, the favicons — is MUTABLE across a rebuild and must
```

Leave the rest of the block (the sw.js reasoning) exactly as it is.

### 1g. Tests (`bridge/server.test.ts`)

**Widen the import** at lines 3-28 to include `isPrivateStaticFile`.

**Drop the stale entry** at `server.test.ts:1042` — remove the `"build-info.json"` line from the
`cacheControlFor` no-cache loop. The helper still returns `no-cache` for it, but listing an
unreachable path among "mutable dist-root files" is now a lie in a test that documents the route.

**Add a new describe.** ⚠️ **Read this or you will look like you broke the suite.** The existing
`resolveStaticPath` describe uses `const WEB = "/srv/collie/web/dist"` — a hardcoded POSIX path. On
Windows `join`/`normalize` emit backslashes, `full.startsWith(WEB + sep)` fails, and those tests
return `null`. They are part of the **36 known Windows failures**; do not chase them and do **not**
add cases to that describe or the fail count goes 36 → 38. Build `WEB` platform-natively in your new
one so it passes on both:

```ts
// issue #11: three checks key off `rel` (the private-file denial, sw.js's Service-Worker-Allowed
// header, and cacheControlFor's immutable/no-cache split), but `rel` used to come straight from the
// request while only `full` was normalised — so "/./build-info.json" cleared the containment check
// and then dodged a rel-keyed denial. WEB is built with join() so this runs on Windows too; the
// older describe above hardcodes a POSIX path and is a known Windows-only failure.
describe("resolveStaticPath — rel is normalised, not echoed", () => {
  const WEB = normalize(join("/srv", "collie", "web", "dist"));

  test.each([
    ["/./build-info.json", "build-info.json"],
    ["/a/../build-info.json", "build-info.json"],
    ["/./assets/app.js", "assets/app.js"],
    ["/assets/app.js", "assets/app.js"],
    ["/", "index.html"],
    ["//sw.js", "sw.js"],
  ])("%s → rel %s", (pathname, rel) => {
    expect(resolveStaticPath(pathname, WEB)?.rel).toBe(rel);
  });
});

// The build id in a file, served to anyone who could reach the port. Nothing fetches this path —
// the bridge and collie-ctl read it off disk — so refusing it costs nothing (issue #11).
describe("isPrivateStaticFile", () => {
  test("build-info.json is never served", () => {
    expect(isPrivateStaticFile("build-info.json")).toBe(true);
  });

  test("every other dist file still is", () => {
    for (const rel of ["index.html", "sw.js", "manifest.webmanifest", "assets/app.js"]) {
      expect(isPrivateStaticFile(rel)).toBe(false);
    }
  });
});
```

Import `normalize` and `join` from `node:path` in the test file if they aren't already there.

`serveStatic` itself stays unit-untested: it is an HTTP handler doing real disk I/O, and
`CLAUDE.md` → *Tests* explicitly parks those ("the bits that genuinely need `Bun.serve` … stay
unit-untested"). Both decisions it now makes are pure and exported — `isHostAllowed` (already
covered by `server.test.ts:316`) and `isPrivateStaticFile`. Verify the wiring by hand (see *Verify*).

**Commit message:** `Gate static serving on the Host allowlist and stop serving build-info.json`

---

## Commit 2 — scheme-relative links (`web/src/lib/markdown.ts`)

Replace `safeHref`'s middle branch (`markdown.ts:64-66`):

```ts
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href === "") return null;
  if (href.startsWith("#")) return href;
  // A rooted path stays same-origin and is harmless — but "//evil.tld/login" is not one. It is a
  // scheme-relative NAVIGATION to another host wearing a rooted path's clothes, and the href here
  // comes from agent output, which the renderer opens with target="_blank" (issue #11). "/\evil.tld"
  // is the same attack: for special schemes the URL parser treats a backslash as a slash, so
  // browsers resolve it identically. Refusing beats resolving against the origin — it keeps this
  // function pure, and an unsafe href already renders as its literal Markdown rather than vanishing.
  if (href.startsWith("/")) return /^\/[/\\]/.test(href) ? null : href;
  return SAFE_SCHEME.test(href) ? href : null;
}
```

A leading `\` (e.g. `\\evil.tld`) already falls through to `SAFE_SCHEME` and returns `null`. The
inline-link regex (`markdown.ts:77`, `[^)\s]+`) excludes whitespace, so there is no tab/newline
variant to handle.

### Tests (`web/src/lib/markdown.test.ts`)

Add to the existing `refuses` table at lines 22-31 — it is already an `it.each`, so this is two rows:

```ts
    ["scheme-relative //", "//evil.tld/login"],
    ["scheme-relative /\\ (browsers normalise it to //)", "/\\evil.tld/login"],
```

The `allows` table at 11-19 already covers `/pane/w1:p1` and `#section`; leave it. Optionally add
`["rooted path with a nested slash", "/pane/w1:p1/history"]` to pin that a *single* leading slash is
still fine — that is the regression this change could plausibly cause.

**Commit message:** `Refuse scheme-relative link targets in agent Markdown`

---

## Commit 3 — control keys are not menu keys

### 3a. `web/src/lib/harness/menu-hints.ts`

**Delete lines 70-71:**

```ts
  const ctrl = /^ctrl\+([a-z])$/.exec(lower);
  if (ctrl) return `ctrl+${ctrl[1]}`;
```

`const lower` is still used by the `enter`/`esc`/`tab` comparisons above — do not remove it.

**Fix the doc comment.** Line 51 currently ends `… ↑ ↓ ← → · ctrl+<letter>`. Make it:

```
 *   enter · esc/escape · tab · shift+tab · a bare lowercase letter · ↑ ↓ ← →
 *
 * NOT digits: see the header and .adr/0009. NOT ctrl+<letter> either, and for a different reason
 * (.adr/0013): every other key here is IN-BAND — the modal consumes it, so the worst case is the
 * wrong answer to the question on screen. A control key is not. ctrl+c/d/z reach the harness's
 * signal handling whatever the screen shows: interrupt, EOF, suspend. Since the label and the key
 * are parsed from the SAME agent-written text, an agent printing "ctrl+c to Continue" got a button
 * reading "Continue" that killed its own run (issue #11). The operator's own Ctrl-C is unaffected —
 * it is a hardcoded preset in components/nav-tray.tsx and never comes through here.
```

Also update the header invariant at lines 9-11 ("ONLY KEYS THE SCREEN NAMED"), which now overstates
the rule — append: `A control key is excluded even when the screen names it (.adr/0013).`

### 3b. `web/src/lib/harness/menu-hints.test.ts`

Exactly one assertion breaks. **Delete line 21** (`expect(menuKeyFor("ctrl+g")).toBe("ctrl+g");`) and
add a describe beside the digit one at lines 26-31, so the ban is pinned rather than merely absent:

```ts
  // .adr/0013: unlike the footer's other keys, a control key isn't consumed by the modal — it
  // reaches the harness's signal handling. The label comes from the same agent text as the key, so
  // "ctrl+c to Continue" was a button reading "Continue" that interrupted the run (issue #11).
  it("NEVER maps a control key, even when the footer names one", () => {
    for (const token of ["ctrl+c", "ctrl+d", "ctrl+z", "ctrl+g", "ctrl+e", "Ctrl+C"]) {
      expect(menuKeyFor(token), token).toBeNull();
    }
  });
```

The existing `declines prose, unsupported keys, and uppercase letters` case at line 33 already
includes `"ctrl+shift+p"` and stays green.

### 3c. Nothing else in the suite moves — verified, don't go looking

- **No fixture changes.** Eleven fixtures under `web/src/fixtures/panes/` carry a `ctrl+` footer
  (`claude--permission-bash.txt:55`, `claude--select-preview-note-input.txt:36`,
  `claude--wizard-multiselect-pointer-next.txt:21`, and the eight `claude--plan-approval*` files),
  but **none lifts a `menu` block**: `claude/menu.ts:74` bails via `if (classifyFooter(footer) !==
  null) return null;`, and `claude/markers.ts:187-194` claims every one for a specific grammar. The
  three real menu fixtures (`claude--menu-model-picker*.txt`) have no `ctrl+` in their footers.
- `web/src/lib/harness/omp.test.ts:206-225` stays green — no omp footer has `ctrl+`, and that file's
  tripwire (header at 183-188) fires on *widening* `menuKeyFor`, not narrowing.
- `conformance.ts:472` (`expect(menuKeyFor(key)).toBe(key)`) is the tripwire that would catch any
  adapter emitting a ctrl key. Nothing does today, so it stays green — leave it alone; it is what
  keeps this fix enforced in future.

### 3d. `HARNESS_CONTRIBUTING.md`

Item 2 of the adapter contract list is `**Never a digit**, …` (~line 100). Add a sibling item after
it and renumber the two below (currently 3 and 4):

```md
3. **Never a control key**, even when the screen prints one in its footer —
   [ADR 0013](./.adr/0013-a-control-key-is-not-a-menu-key.md) records why (a control key isn't
   consumed by the modal; it reaches the harness's signal handling, and the button's label came from
   the same agent text as the key).
```

### 3e. `.adr/0013-a-control-key-is-not-a-menu-key.md` (new)

Nygard format, matching the house style. Keep it to roughly the length of ADR 0012.

- **Context** — ADR 0009 accepted "only keys the screen printed" and `menuKeyFor` whitelisted
  `ctrl+<letter>` on that basis. The trust argument was that a screen naming its own keys is the one
  thing about an unknown modal we can trust. State the gap: **the label and the key are parsed from
  the same agent-written text**, so an agent printing `ctrl+c to Continue` gets a button labelled
  "Continue" that sends `ctrl+c`. Then the load-bearing distinction: every other whitelisted key is
  in-band (the modal consumes it; the worst case is the wrong answer to a visible question), whereas
  a control key is out-of-band — `ctrl+c`/`ctrl+d`/`ctrl+z` are interrupt/EOF/suspend and act on the
  session, not the dialog. Note the exposure is same-pane only: an agent can only do this to its own
  run, which is why this is Low and not a gate. Note that no shipped fixture emits one, so this
  closes a live-screen path rather than fixing an observed break.
- **Decision** — A generically-detected menu emits only the **in-band** keys the screen printed, plus
  arrows it advertised. The ban lives in `menuKeyFor`, not in `isValidHerdrKey`: `ctrl+k` is a valid
  Herdr key that `preview-action.ts` legitimately sends. Operator-composed control keys (the Keys
  dock, `nav-tray.tsx`'s Ctrl-C) are untouched — they are chosen by the person, not by the screen.
- **Consequences** — A future unrecognised modal printing `ctrl+g to edit in nano` gets no button for
  it; the raw mirror and the Keys pad still drive it, which ADR 0009 already accepted as the
  fallback. `conformance.ts:472` fails any adapter that tries to emit one. Revisit if Herdr ever
  exposes structured menu state, since the trust would then not come from parsed text at all.

**Also add one line to `.adr/0009`,** under its `Status:` line and nothing else — do not edit its
reasoning (`CLAUDE.md`: a superseded ADR is never edited into agreement with the present; 0009 is
narrowed, not superseded):

```md
Status: **Accepted** (2026-08-05) — narrowed by [0013](./0013-a-control-key-is-not-a-menu-key.md)
```

**Commit message:** `Stop agent text from choosing a control key for a labelled button`

---

## Commit 4 — restore the missing request file

`requests/issue-11-frontend-static-hardening.md` — the ADW input for this run — does not exist,
though issues #1, #5, #8 and #9 have theirs. Create it from the issue body:

```bash
gh issue view 11
```

First line `# Issue #11 — Low: frontend/static hardening — build-info bypasses host allowlist, //
links, ctrl+ hint keys`, then the three numbered items verbatim. Commit alongside the rest.

---

## Verify

Run from the repo root. **Judge every command by its exit status, not by words in its output.**

```bash
cd web && bun run test && cd ..   # frontend
bun test ./bridge                 # backend
bun run build                     # typechecks BOTH sides, then builds web
```

**Baselines measured on this machine before the change:**

| Suite | Before | After |
|---|---|---|
| `cd web && bun run test` | 108 files, **2269 pass, 0 fail** | 0 fail, higher pass count |
| `bun test ./bridge` | **607 pass / 36 fail** | **36 fail** — not 37, not 38 |

The 36 backend failures are pre-existing POSIX assumptions on Windows (`/srv/...` paths, chmod, unix
sockets) — see `NEXT-SESSION.md:42`. Do not chase them. **A count of 38 means you added cases to the
old `resolveStaticPath` describe instead of the new one — go back to *Commit 1g*.**

The web suite is fully green today, so **any** web failure is yours.

Manual smoke on a Linux host with the bridge running (skip on Windows). Remember
`systemctl --user restart collie` first — Bun does not hot-reload the bridge, and commit 1 is a
`bridge/` change (`CLAUDE.md` → *Build / run*). Commits 2 and 3 are `web/` and go live on
`bun run build` with no restart.

```bash
# with COLLIE_PUBLIC_HOSTS unset — nothing changes
curl -si http://127.0.0.1:8787/ | head -1                      # 200
curl -si http://127.0.0.1:8787/build-info.json | head -1       # 404 (this is the one change)

# with COLLIE_PUBLIC_HOSTS=collie.example.com
curl -si -H 'Host: evil.tld' http://127.0.0.1:8787/            # 403 host not allowed
curl -si -H 'Host: evil.tld' http://127.0.0.1:8787/assets/     # 403 host not allowed
curl -si -H 'Host: collie.example.com' http://127.0.0.1:8787/ | head -1   # 200
curl -si http://127.0.0.1:8787/./build-info.json | head -1     # 404 — the dot-segment dodge
curl -si http://127.0.0.1:8787/ | grep -i x-collie-build       # still stamped
curl -s  http://127.0.0.1:8787/api/config                      # still reports build
```

Then load the PWA on the phone once and confirm the footer build stamp and the "new build" banner
still work — that is the only user-visible thing `build-info.json` sits near.

---

## Versioning — bump nothing

`gh repo view` confirms `isFork: true` (`origin` = `bartholomewtj/collie`, `upstream` =
`AltanS/collie`). Per `CLAUDE.md` → *Versioning*, a **fork PR leaves all four files alone**: do not
touch `herdr-plugin.toml`, `package.json`, `web/package.json` or `CHANGELOG.md`. All four agree on
`0.29.0` and `scripts/check-version.sh` stays green either way. Every fork commit so far has done the
same.

The pre-commit hook will object because `bridge/` and `web/src/` changed. Use the documented escape
hatch on each functional commit: `SKIP_VERSION_CHECK=1 git commit …`.

Put the proposed CHANGELOG lines in the PR description instead, in the repo's house style:

> - **The static route is behind the Host allowlist** — `COLLIE_PUBLIC_HOSTS` now covers the app
>   shell and its assets, not just `/api/*`, and `build-info.json` is no longer served at all (#11)
> - **A Markdown link can't be scheme-relative** — `//evil.tld` in agent output rendered as a real
>   off-origin link; it now stays literal text (#11)
> - **Agent text can't put a control key behind a labelled button** — `ctrl+c to Continue` made a
>   "Continue" button that interrupted the run (#11)

---

## PR

`gh pr create` against `main`, referencing `Fixes #11`. The body should cover:

1. That `serveStatic` was the **last** route skipping `checkAccess`, and that this is the same hole
   #32 closed for `/api/config` — quote that route's own comment, which claims it was "the one route".
2. That `README.md:142`'s "rejects any request addressed to another Host" was false for static and is
   now true — the fix makes the doc honest rather than needing a doc edit.
3. That only the **Host** check was applied, not `guard()`, and why (no Origin on a navigation; the
   identity gate would 403 the whole PWA).
4. That `resolveStaticPath` now normalises `rel`, that this was **required** (`/./build-info.json`
   would otherwise dodge the denial), and that it incidentally fixes `sw.js`'s
   `Service-Worker-Allowed` header and `cacheControlFor`'s immutable/no-cache split for dot-segment
   paths.
5. That dropping `build-info.json` breaks nothing, with the three on-disk readers named.
6. The in-band/out-of-band distinction for `ctrl+`, and that ADR 0009 is **narrowed, not superseded**.
7. **That the issue's "mark text-parsed buttons visually" was deliberately declined**, with the three
   reasons from *Decisions* — every menu button is screen-derived, the raw region is already mirrored
   directly above them by design, and in-button text breaks the accessible-name assertions.
8. That the operator's own Ctrl-C (`nav-tray.tsx`) and `isValidHerdrKey` are untouched.
