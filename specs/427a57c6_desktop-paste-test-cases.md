# Plan — close the reviewer's remaining test findings on 0260861 (0.56.8)

## What this is

Commit `0260861` ("Desktop mode: paste hold, Ctrl+F find, README section") was reviewed in ADW
`1b24cf9e`. The reviewer met 16 of 17 requirements. The one open item is **test coverage only** —
seven enumerated cases from the plan are not on disk. Product code is approved and **does not
change**.

This plan adds those cases to the four test files that `0260861` itself created, then cuts a PATCH
release `0.56.8`.

Reviewer's blocking list: `adws/adw_data/sessions/1b24cf9e/context_handoff/review.md`, section
"Blocking".

## Hard rules for this task

- **Only test files change, plus the four version/changelog files.** No product code. If a new test
  fails, the test is wrong, not the code.
- **Do not edit any test file that existed before `0260861`.** The four files below were *added* by
  `0260861`, so adding cases to them is fine. Everything else under `web/src/**/*.test.*` and
  `bridge/**/*.test.ts` is off limits.
- Out of scope entirely: `web/src/hooks/use-display-prefs.ts`, `bridge/`,
  `web/src/hooks/use-long-press.ts`, and every non-test source file.
- `web/` TypeScript is strict with `verbatimModuleSyntax` + `erasableSyntaxOnly` — use `import type`
  for type-only imports, and no unused locals or parameters.

## Baseline measured before starting (2026-08-22)

Run these numbers again at the end; only the web `passed` count should move.

| Command | Result now |
|---|---|
| `bun run test` (root) | `Ran 859 tests across 37 files` — 839 pass, 20 skip, 0 fail (ctl suite skips on Windows, which is correct) |
| `cd web && bun run test` | 147 files, `2801 passed \| 19 todo (2820)` |
| `bun run typecheck` (root) | clean |

Adding the eight cases below takes web to **2809 passed | 19 todo (2828)**. Root must still say
**859**.

---

## Facts the tests depend on (verified in the source — don't re-derive)

`web/src/hooks/use-direct-typing.ts:367-407` — the native `paste` listener, attached **only** when
`desktop && active`:

- Image item first: on `item.kind === "file"` and `item.type.startsWith("image/")` it
  `preventDefault()`s, uploads, and on success sets a `path` hold whose `onSend` runs
  `clearPasteHold()` then `sender.enqueue(textToKeySequence(path))`.
- Text: `raw` is normalised (`\r\n?` → `\n`). If it has **no** `\n` **and** `isDestructiveInput`
  returns `null`, it enqueues straight away with no hold. Otherwise it strips trailing newlines
  (`body = normalised.replace(/\n+$/, "")`) and sets a `text` hold with
  `lines: body.split("\n").length` and `reason: isDestructiveInput(body)`.

Consequences the new cases pin:

- `"echo hi\n"` → held (it contains `\n`) with `lines: 1`, `reason: null`, and `onSend` enqueues
  `textToKeySequence("echo hi")` = `["e","c","h","o","Space","h","i"]` — **no `"Enter"` anywhere**.
  The existing multiline case uses two lines, so it cannot lock this.
- `"rm -rf /tmp/x"` → held even though it is one line, with
  `reason === "rm -r (recursive delete)"` (`web/src/lib/destructive.ts:18`), which matches `/rm -r/`.
- `textToKeySequence` (`web/src/lib/key-queue.ts:117`) maps `" "`→`"Space"`, `"\t"`→`"Tab"`,
  `"\n"`→`"Enter"`, everything else to the character. So `textToKeySequence("/host/shot.png")` is a
  plain per-character array.
- `sender.enqueue` (`web/src/hooks/use-ordered-key-sender.ts:62`) calls `pump()` synchronously and
  `pump` calls `sendRef.current(batch)` before its first `await`. **`sendKeys` is therefore observable
  synchronously after `onSend()`** — no `waitFor` needed (the existing multiline case already relies
  on this).
- `web/src/components/direct-typing-strip.tsx:23` — `buttonProps` puts
  `onPointerDown={(e) => e.preventDefault()}` on Send, Discard and Type path (so the textarea keeps
  focus). Only the Stop button lacks it.
- `web/src/lib/paste-hold.ts:18` — `__resetPasteHold()` sets `hold = null` **without emitting**.
- `web/src/lib/find-request.ts` — module-scoped `Set` of listeners; `requestFindOpen()` just iterates
  it.

---

## Step 1 — `web/src/hooks/use-direct-typing-paste.test.tsx` (4 new cases)

The file already has a `Probe` component, a `paste(text, items)` helper, and
`afterEach(() => { cleanup(); __resetPasteHold(); })`. **Reuse them; do not restructure the file and
do not touch the six existing `it(...)` lines.**

Add one import at the top (the file does not have it yet):

```ts
import { textToKeySequence } from "@/lib/key-queue";
```

Then append four `it(...)` cases inside the existing `describe("desktop paste", ...)`. Follow the
file's house style (one dense line per case is what is already there; keep it readable but don't
reformat neighbours).

The union type `PasteHold` needs narrowing before you can read `.lines` / `.reason`, so read the hold
into a local first — this keeps `tsc --noEmit` clean:

```tsx
it("holds a trailing newline as one line and sends no Enter", () => {
  render(<Probe />);
  fireEvent.click(screen.getByText("arm"));
  paste("echo hi\n");
  const hold = pasteHold();
  expect(hold?.kind).toBe("text");
  expect(hold?.kind === "text" ? hold.lines : null).toBe(1);
  act(() => hold?.onSend());
  expect(lastSend).toHaveBeenCalledWith(textToKeySequence("echo hi"));
  expect(lastSend.mock.calls[0][0]).not.toContain("Enter");
});

it("names the destructive reason on a single-line hold", () => {
  render(<Probe />);
  fireEvent.click(screen.getByText("arm"));
  paste("rm -rf /tmp/x");
  const hold = pasteHold();
  expect(hold?.kind === "text" ? hold.reason : null).toMatch(/rm -r/);
  expect(lastSend).not.toHaveBeenCalled();
});

it("types the uploaded path only after Type path", async () => {
  render(<Probe image />);
  fireEvent.click(screen.getByText("arm"));
  const file = new File(["x"], "shot.png", { type: "image/png" });
  paste("", [{ kind: "file", type: "image/png", getAsFile: () => file }]);
  await vi.waitFor(() => expect(pasteHold()?.kind).toBe("path"));
  expect(lastSend).not.toHaveBeenCalled();
  act(() => pasteHold()?.onSend());
  expect(lastSend).toHaveBeenCalledWith(textToKeySequence("/host/shot.png"));
});

it("never holds or sends on a phone", () => {
  render(<Probe desktop={false} />);
  fireEvent.click(screen.getByText("arm"));
  paste("a\nb");
  expect(pasteHold()).toBeNull();
  expect(lastSend).not.toHaveBeenCalled();
});
```

Notes for whoever types this in:

- `act` is already imported in this file; wrap `onSend()` in it because `enqueue` sets React state
  (`setBusy(true)`) — without `act` React 19 logs a warning, and warnings are noise the reviewer will
  read as a regression.
- The phone case uses multiline text on purpose: with `desktop: false` the listener is never attached,
  so even text that *would* be held on desktop leaves the store `null`. This is a **new** case; leave
  the existing `"does nothing on phone"` (`defaultPrevented === false`) alone.
- `vi` is already imported. `lastSend` is module-scoped and re-assigned by each `render`, so read it
  after render, never before.

## Step 2 — `web/src/components/direct-typing-strip-paste.test.tsx` (1 new case)

Add one case asserting that `pointerdown` on Send is prevented, so focus stays in the textarea.
Construct the event by hand and read `defaultPrevented` — that is exactly what the finding asks for,
and it does not depend on jsdom having a real `PointerEvent` constructor:

```tsx
it("keeps focus in the textarea by preventing pointerdown on Send", () => {
  setPasteHold({ kind: "text", lines: 2, reason: null, onSend: vi.fn(), onDiscard: vi.fn() });
  render(<DirectTypingStrip onStop={vi.fn()} />);
  const event = new Event("pointerdown", { bubbles: true, cancelable: true });
  screen.getByRole("button", { name: "Send" }).dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
```

React attaches its `pointerdown` listener at the container root and does not type-check the event
object, so a plain `Event` with that type reaches `onPointerDown`. If for any reason it does not fire
in this jsdom, fall back to `expect(fireEvent.pointerDown(button)).toBe(false)` (`fireEvent` returns
`dispatchEvent`'s boolean, which is `false` when the default was prevented) — but try the explicit
form first.

The file already has `afterEach(__resetPasteHold)` and imports `fireEvent`, `render`, `screen`,
`setPasteHold`, `vi`. Add nothing else.

## Step 3 — `web/src/lib/find-request.test.ts` (1 new case)

`requestFindOpen()` with **no** subscribers must not throw. The listener set is module-scoped and the
existing case deliberately leaves `second` subscribed (it only unsubscribes `first`), so the new case
must run **before** it. Vitest runs `it`s in declaration order, so put the new case **first inside the
`describe`**, with a comment saying why it sits there:

```ts
describe("find request", () => {
  // First on purpose: the store is module-scoped and the case below leaves a listener subscribed.
  it("does not throw with no subscribers", () => {
    expect(() => requestFindOpen()).not.toThrow();
  });

  it("notifies subscribers and unsubscribes", () => { /* unchanged */ });
});
```

Do not modify the existing case's body.

## Step 4 — `web/src/lib/paste-hold.test.ts` (1 new case)

`__resetPasteHold()` must return the store to `null`. It is already imported at the top of the file.
Append:

```ts
it("resets the store without notifying", () => {
  const listener = vi.fn();
  const off = onPasteHoldChange(listener);
  setPasteHold({ kind: "text", lines: 1, reason: null, onSend: vi.fn(), onDiscard: vi.fn() });
  __resetPasteHold();
  expect(pasteHold()).toBeNull();
  expect(listener).toHaveBeenCalledOnce();
  off();
});
```

The `toHaveBeenCalledOnce()` line pins the *silent* half of `__resetPasteHold` (one emit from
`setPasteHold`, none from the reset) — that silence is why it is a test-only escape hatch and not a
second `clearPasteHold`. `off()` at the end keeps the module-scoped set clean for the file's other
cases. If you would rather keep the case to the letter of the finding, drop the listener lines and
assert only `pasteHold()` is `null`; keeping them is better and costs nothing.

## Step 5 — version bump to 0.56.8

PATCH: the code already does what it was meant to do; only tests were missing.

Set `0.56.7` → `0.56.8` in exactly three places:

- `herdr-plugin.toml` line 3 — `version = "0.56.8"`
- `package.json` line 3 — `"version": "0.56.8",`
- `web/package.json` line 3 — `"version": "0.56.8",`

## Step 6 — CHANGELOG entry

Insert a new heading directly above `## [0.56.7] - 2026-08-22` in `CHANGELOG.md`:

```markdown
## [0.56.8] - 2026-08-22

### Changed
- Desktop mode: test coverage for paste hold and find request edge cases
```

Use `### Changed` (not `Added`) and the exact wording above — it is what the ask specifies. Cite no
commit hash: this release *is* the change, and there is no earlier feature commit to point at.

Then run `bash scripts/check-version.sh` — it must print `✓`.

---

## Verify (all four must pass)

```bash
cd web && bun run test          # 147 files, 2809 passed | 19 todo (2828); 0 failed
cd .. && bun run test           # still "Ran 859 tests across 37 files", 0 fail
bun run typecheck               # clean (also run by both test scripts)
bash scripts/check-version.sh   # prints ✓
```

Then confirm no forbidden file moved:

```bash
git status --porcelain
```

The only paths listed should be:

```
web/src/hooks/use-direct-typing-paste.test.tsx
web/src/components/direct-typing-strip-paste.test.tsx
web/src/lib/find-request.test.ts
web/src/lib/paste-hold.test.ts
herdr-plugin.toml
package.json
web/package.json
CHANGELOG.md
```

plus this plan and its `specs/` copy. Anything else — especially `web/src/hooks/use-direct-typing.ts`,
`web/src/components/direct-typing-strip.tsx`, `web/src/hooks/use-display-prefs.ts`,
`web/src/hooks/use-long-press.ts`, or anything under `bridge/` — is a scope break; revert it.

## Commit and PR

Branch off the current `main` (`ea1d91f`); do not commit to `main` directly.

- Branch: `test/desktop-paste-coverage`
- Commit subject: `Desktop mode: cover paste hold and find request edge cases (0.56.8)`
- Body: name the seven reviewer findings closed and state that no product code changed.
- `git push -u origin test/desktop-paste-coverage` then `gh pr create`. The pre-push hook runs both
  suites; do not use `SKIP_TESTS=1`.
- **Tag on merge, not on push of the branch.** Once `0.56.8` is on `main`:
  `git tag -a v0.56.8 -m "Collie 0.56.8" && git push origin v0.56.8`.

## Things that will bite

1. **`use-direct-typing.ts` is approved code.** If `paste("echo hi\n")` does not hold, re-read the
   listener before touching anything — the trailing-newline branch is at `:401-403` and it is correct.
2. **`afterEach(__resetPasteHold)` matters.** Every case in the hook test file must leave the store
   clean or the next case reads a stale hold. The `afterEach` is already there; don't add a second one.
3. **Order dependence in `find-request.test.ts` is deliberate** (Step 3). If someone later reorders
   that file the case fails loudly, which is the right failure.
4. **Don't "fix" the muted empty ` — ` in the strip** for a `reason === null` text hold. The reviewer
   logged it as non-blocking; it is product code and out of scope here.
5. **Root test count is a gate.** If root moves off 859 you edited something under `bridge/` or
   `scripts/`.
