# Plan — finish the three test files the reviewer blocked on 60aeb58 (0.56.5)

**This is a test-only change plus a version bump. Product code is approved and does not change.**

The reviewer's pass 3 on commit `60aeb58`
(`adws/adw_data/sessions/9251a58e/context_handoff/review.md`) marked 16 of 19 findings met. Three
are open — 15, 16, 17 — and all three are missing assertions in three test files that already
exist and already pass. Your job is to add the missing assertions, nothing else.

## Baseline (measured 2026-08-22, before any edit)

- `cd web && bun run test -- --run src/components/composer-desktop.test.tsx src/components/agent-chat-arm.test.tsx src/hooks/use-direct-typing-desktop.test.tsx` → **3 files, 19 tests, all pass** (note: `bun run test` in `web/` runs `tsc --noEmit` first, so a type error fails the run before Vitest starts).
- `bun run test` at the repo root → **859 tests across 37 files, 839 pass / 20 skip / 0 fail**. Nothing in this plan touches `bridge/`, so this number must be 859 again at the end.
- Version is `0.56.4` in `herdr-plugin.toml:3`, `package.json:3`, `web/package.json:3`, and the newest CHANGELOG heading.

## Hard rules

1. **Do not edit any existing test file.** In particular do not touch, and do not add exports to,
   `web/src/components/composer.test.tsx`. Copy its local helpers into the file that needs them.
2. **Do not touch product code.** Not `composer.tsx`, not `agent-chat.tsx`, not
   `use-direct-typing.ts`, not `direct-typing-strip.tsx`. If a new assertion fails, the assertion is
   wrong — re-read the product code and fix the test.
3. **Out of scope, do not open to edit:** `web/src/hooks/use-display-prefs.ts`, anything under
   `bridge/`, `web/src/hooks/use-long-press.ts`, `web/src/lib/key-queue.ts`.
4. **`web/` has `noUnusedLocals`.** A copied helper that no test calls is a typecheck failure, not a
   warning. Copy a helper only into a file that actually uses it (see the note on
   `awaitTerminalStall` below).

## Files you will change

| File | Why |
|---|---|
| `web/src/components/composer-desktop.test.tsx` | finding 15 — most rows of the reviewer's table are missing or faked |
| `web/src/components/agent-chat-arm.test.tsx` | finding 16 — gone-pane case only checks the reason |
| `web/src/hooks/use-direct-typing-desktop.test.tsx` | finding 17 — dead status sentinel, no status assert |
| `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md` | PATCH bump to 0.56.5 |

---

## Helpers to copy (verbatim, from `web/src/components/composer.test.tsx`)

`composer.test.tsx:19-27`:

```tsx
function replyHandler(onTyped: (text: string) => void, onSubmit?: () => void) {
  return http.post(/\/api\/pane\/[^/]+\/reply$/, async ({ request }) => {
    const body = (await request.json()) as { text: string; submit?: boolean };
    recordReply(body);
    if (body.submit) onSubmit?.();
    else onTyped(body.text);
    return HttpResponse.json({ ok: true });
  });
}
```

`composer.test.tsx:78-81`:

```tsx
function StatusSentinel() {
  const status = useStatus();
  return <div data-testid="status">{status?.text ?? ""}</div>;
}
```

**Why `replyHandler` and not a hand-rolled handler:** a guarded send is *two* POSTs — type
(`submit:false`), then submit-only (empty text) once the typed text is seen on the fake pane's input
line. `recordReply` (`web/src/test/handlers.ts:129`) is what puts it there; `paneTextWithDraft`
(`:140`) renders it inside a Claude-shaped input box that the pane GET returns. Skip `recordReply`
and the verify poll never passes.

**`awaitTerminalStall` (`composer.test.tsx:71-76`): copy it ONLY if you leave a send unverified.**
It exists for sends that can never verify (a handler that doesn't `recordReply`), which stall for
~2.8s and then fire a `setStatus` on a module-scoped singleton into whatever test is running by
then. Every send in this plan goes through `replyHandler` or the default handlers, both of which
`recordReply`, so every send verifies and there is no stall to await. Copying it unused breaks
`noUnusedLocals`. If you end up writing a test whose send cannot verify, copy the helper and end
that test with `await awaitTerminalStall()`.

### Two assertion techniques you will use repeatedly

- **`defaultPrevented`:** `fireEvent.keyDown(el, {...})` returns the result of `dispatchEvent` —
  `false` when the handler called `preventDefault()`, `true` when it did not. So
  `expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(true)` reads "not prevented", and
  `.toBe(false)` reads "prevented". (The existing `new KeyboardEvent(...)` +
  `expect(event.defaultPrevented)` shape also works; either is fine, don't mix them inside one test.)
- **A real newline:** only `userEvent` inserts text. `await user.type(box, "hello{enter}")` puts
  `"hello\n"` in a textarea *if and only if* nothing prevented the key — so a single assertion
  proves the newline and the not-prevented behaviour together. Never fake it with
  `fireEvent.change(box, { target: { value: "\n" } })`; the reviewer called that out explicitly.

---

## 1. `web/src/components/composer-desktop.test.tsx` (finding 15)

Keep the existing `mount(overrides, withStatus)` helper and the existing local `StatusSentinel` —
the reviewer already marked the phone-draft-refusal row met. Add `replyHandler` (imports `http`,
`HttpResponse`, `recordReply`, `server` — all already imported in this file).

Desktop is off by default (`DEFAULTS.on === false` in `web/src/lib/desktop.ts`) and `beforeEach`
already calls `__resetDesktop()`. Write `setDesktop(false)` explicitly in the phone tests anyway so
the branch under test is visible in the test body.

Every row below must exist. Rows already met are marked *(keep)* — do not weaken them.

### `on: false` (phone half)

Replace the current "keeps phone Enter as a newline" test (`:30-37`), which asserts the value is
still `"hello"` — the opposite of the requirement:

- `setDesktop(false)`; install `server.use(replyHandler((t) => typed.push(t)))`.
- `await user.type(box, "hello{enter}")` → `expect(box).toHaveValue("hello\n")`.
- `expect(typed).toEqual([])` — nothing sent.
- `expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(true)` — not `defaultPrevented`.

*(keep)* Phone "Type into terminal" with a non-empty draft → status is exactly
`Send or clear the draft before typing into the terminal.` (`:39-44`).

### `on: true` (desktop half)

- **Enter sends the typed text and is prevented.** `setDesktop(true)`;
  `server.use(replyHandler((t) => typed.push(t), () => submits++))`; `await user.type(box, "hello")`;
  `expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false)` (prevented);
  `await waitFor(() => expect(typed).toEqual(["hello"]))`;
  `await waitFor(() => expect(submits).toBe(1))`; `await waitFor(() => expect(box).toHaveValue(""))`.
  (`"hello"` is deliberately not destructive, so it goes straight through — `composer.tsx:657-663`.)
- **Shift+Enter inserts a newline and sends nothing.** After `await user.type(box, "abc")` (focus
  stays on the box), `await user.keyboard("{Shift>}{Enter}{/Shift}")` →
  `expect(box).toHaveValue("abc\n")` and the reply array is still empty.
- **Enter while composing does nothing.** Use the form the reviewer named:
  `expect(fireEvent.keyDown(box, { key: "Enter", isComposing: true })).toBe(true)` and assert **no**
  reply went out. If jsdom drops `isComposing` off the init dict, fall back to the file's existing
  `new KeyboardEvent(...)` + `Object.defineProperty(event, "isComposing", { value: true })` shape —
  but the "no reply" assert is mandatory either way. The product reads
  `e.nativeEvent.isComposing` (`composer.tsx:1004`).
- **Ctrl+Enter still sends.** `fireEvent.keyDown(box, { key: "Enter", ctrlKey: true })` returns
  `false` (prevented) and the text reaches `replyHandler`. Replace the current `:73-76`, which
  asserts the value is *still* `"ctrl"` and never checks for a reply. This chord is handled before
  the desktop branch (`composer.tsx:999-1003`), so it must work with `on: false` too — assert it in
  one of the two halves, your choice, and say which in a comment.
- *(keep)* Empty box: `Escape` / `Tab` / `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` each
  POST `/api/pane/:id/keys` with exactly `["Escape"]` / `["Tab"]` / `["Up"]` / `["Down"]` /
  `["Left"]` / `["Right"]` (`:79-89`, matches `PASS_THROUGH_KEYS` at `composer.tsx:35-38`).
- *(keep)* Empty box + Ctrl+C → no `/keys` call and not prevented (`:90-93`).
- **Non-empty box sends no keys.** The current test (`:96-98`) fires `Escape` and `ArrowUp` and
  asserts nothing. Install the `/keys` handler that pushes into a `keys` array, set the box to
  `"text"`, fire both, and assert `expect(keys).toEqual([])` plus both events not prevented
  (`composer.tsx:1009` returns early once `input.length !== 0`).
- **Destructive two-tap.** Extend `:101-106`: after the first Send click, assert the status matches
  `/Destructive: .*tap Send again/` **and** that no reply went out; then click Send a second time and
  assert the text reaches `replyHandler` (`composer.tsx:657-663`).

Prefer one `userEvent.setup()` per test (`const user = userEvent.setup()`), created before the
`mount()` in that test.

## 2. `web/src/components/agent-chat-arm.test.tsx` (finding 16)

Only the last test changes — `"shows locked strip for gone pane"` (`:24`). It currently asserts the
reason and stops. Add the two missing asserts, mirroring the read-only test one line above it,
which already has exactly this shape:

- `expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()` before the click.
- Click the mirror — `fireEvent.click(screen.getByText("output"))`, or
  `fireEvent.click(screen.getByTestId("mirror-region"))` if the text node isn't reachable on a gone
  pane; the `onClick` lives on the region (`agent-chat.tsx:790-795`).
- After the click, assert it did **not** arm. `active === false` is observable three ways; assert at
  least the first two:
  - `expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()` — `DirectTypingStrip`
    renders Stop only when not `disabled`, and `disabled={!direct.active}` (`composer.tsx:1063-1070`,
    `direct-typing-strip.tsx:29-38`).
  - `expect(screen.getByTestId("mirror-region")).not.toHaveClass("ring-2")` — the ring is
    `desktop && armed` (`agent-chat.tsx:792-794`).
  - the strip still reads the gone reason (`/pane is gone/`), i.e. it stayed in its disabled form.

The strip is present on a gone pane and that is correct, not a bug: `showDesktopStrip = desktop &&
(direct.active || (typing === "direct" && stripReason !== null))` and `stripReason = gone ? "pane is
gone" : …` (`composer.tsx:362-363`). Arming is refused by the `!gone` guard at
`agent-chat.tsx:598`. Add a one-line comment saying that, so the next reader doesn't "fix" the
present-but-disabled strip.

## 3. `web/src/hooks/use-direct-typing-desktop.test.tsx` (finding 17)

Only the first test changes — `"keeps phone draft refusal and status"` (`:18`). It renders a dead
`<output data-testid="status" />` that is never wired to the status store, so the status assert was
impossible and was left out.

- Import `clearStatus` and `useStatus` from `@/lib/status`.
- Add the `StatusSentinel` copied from `composer.test.tsx` (see above) and render it alongside the
  probe: `render(<><StatusSentinel /><Probe desktop={false} draft="draft" /></>)`.
- Add `clearStatus()` to `beforeEach` (the status store is a module-scoped singleton with a ~2.5s
  auto-clear; without this a status from an earlier test can bleed in). Leave the existing
  `setLocked(false)` in `beforeEach`/`afterEach` alone — do **not** swap it for `resetIdleLock()`.
- Keep `expect(screen.getByTestId("active")).toHaveTextContent("false")`, and add the exact text:
  ```tsx
  expect(screen.getByTestId("status")).toHaveTextContent(
    "Send or clear the draft before typing into the terminal.",
  );
  ```
  That string is `use-direct-typing.ts:126`, the phone-only refusal (`!desktop` + non-empty draft).

Leave the other three tests in the file as they are — the reviewer marked them met.

## 4. Version bump — PATCH 0.56.5

Test-only work still touches nothing functional, but the request specifies the bump, so do it.

- `herdr-plugin.toml:3` → `version = "0.56.5"`
- `package.json:3` → `"version": "0.56.5"`
- `web/package.json:3` → `"version": "0.56.5"`
- `CHANGELOG.md` — new heading directly above `## [0.56.4] - 2026-08-22`:

```markdown
## [0.56.5] - 2026-08-22

### Changed
- Desktop mode: test coverage for Enter-sends and direct-typing arm/release
```

Use the real date. Then `bash scripts/check-version.sh` must print `✓`.

Do **not** push a `v0.56.5` tag — the operator cuts and tags the release.

## Verify (all four must pass)

```bash
bash scripts/check-version.sh                 # prints ✓
bun run typecheck                             # root + web, clean
cd web && bun run test                        # whole web suite green (runs typecheck first)
bun run test                                  # root: 859 tests, 0 fail
git status --porcelain                        # only the 7 files above
git diff --stat -- '*.test.ts' '*.test.tsx'   # only the 3 test files named here
```

The last two commands are the finding-18 check: no existing `*.test.*` file may appear in the diff
other than the three you were told to finish, and `bridge/` must not appear at all.

## Done means

- Every assertion listed in §1, §2 and §3 exists in the named file.
- `cd web && bun run test` passes with every file that existed before `60aeb58` unedited.
- Root `bun run test` still reports 859.
- `bun run typecheck` clean.
- Version is 0.56.5 in all three files with the matching `## [0.56.5]` CHANGELOG heading and the
  `### Changed` line quoted above.
