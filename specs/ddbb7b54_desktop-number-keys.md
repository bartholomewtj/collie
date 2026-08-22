# Plan — desktop mode phase 4: number keys pick prompt options

**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows checkout, Git Bash)
**Branch:** already on `feat/desktop-views` — stay on it. Push → `gh pr create` at the end.
**Version:** 0.56.12 → **0.56.13** (PATCH, as the request pins it)
**Source of truth:** `specs/desktop-mode-spec.md` §10 phase 4 + its "Decisions" table (do not re-open those decisions)
**Request:** `requests/desktop-4-number-keys.md`

## What you are building

In desktop mode, when a recognised prompt dialog is on screen and the composer box is empty, pressing
a digit picks the matching option — through the same race guard a tap on the button uses. Nothing is
ever sent as a raw keystroke, and the digit never lands in the text box.

Everything else about the phone is unchanged (`useDesktop().on === false` → not one behaviour moves).

## Rules that decide every edge case

| Situation | What happens |
|---|---|
| `on: false` (phone) | Nothing changes at all. No interception, digit types normally. |
| Direct typing armed (`direct.active`) | Untouched — the keydown goes to `direct.onKeyDown` and digits reach the pane raw. That branch already exists; do not touch `use-direct-typing.ts`. |
| Box non-empty | Digit types normally (existing `input.length !== 0` early return already does this). |
| No dialog on screen (`dialogPresent === false`) | Digit types normally. A digit in a chat message is just a character. |
| Dialog present, no `promptBlock` (wizard, multi-select, preview, generic menu) | No-op. `preventDefault()`, status **"Use the buttons for this dialog"**. Nothing sent, nothing typed. |
| `promptBlock` present but its feedback row is **focused** | Same no-op + same status. The terminal swallows every digit as a character there (`PLAN_FEEDBACK_NOTES.md`), so no digit may go out. |
| `promptBlock` present, digit matches no option (incl. the plan dialog's text-row digit, e.g. `4`) | No-op. `preventDefault()`, status **"No option 4"**. |
| `promptBlock` present, digit matches an option | `preventDefault()`, call the injected prompt handler with `{ kind: "option", option }` → `submitPromptOption` → dialog guard. |
| Raw terminal pref on (the default) | `grammarsOn` is false, so `dialogPresent` is false and `promptBlock` is null → digits type normally. Correct: there are no prompt buttons in raw mode either. |
| `gone` / `readOnly` | The textarea is `disabled` (`locked`), so no keydown fires. Nothing extra to write. |

Status tone: use `"warn"` for both messages (auto-clears; an `"error"` would persist until tapped).

## Files to change

### 1. `web/src/components/agent-chat.tsx`

Today (~line 225) there is one memo that builds the blocks and throws them away after deriving a
boolean:

```ts
const dialogPresent = useMemo(
  () =>
    grammarsOn
      ? (adapterFor(agent?.agent)?.buildBlocks(splitLines(parseAnsi(display))) ?? []).some(
          (b) => b.kind !== "raw",
        )
      : false,
  [display, agent?.agent, grammarsOn],
);
```

Replace it with a memoised `blocks` array plus two cheap derivations. Keep the existing comment block
above it (it explains why this parse exists) and extend it to say the array is now shared:

```ts
const blocks = useMemo(
  () =>
    grammarsOn ? adapterFor(agent?.agent)?.buildBlocks(splitLines(parseAnsi(display))) ?? [] : [],
  [display, agent?.agent, grammarsOn],
);
const dialogPresent = useMemo(() => blocks.some((b) => b.kind !== "raw"), [blocks]);
// The live dialog is the one nearest the tail, so search from the end.
const promptBlock = useMemo(
  () => blocks.findLast((b) => b.kind === "prompt-select")?.prompt ?? null,
  [blocks],
);
```

Notes:

- `findLast` is fine — `web/tsconfig.json` has `"lib": ["ES2023", …]`.
- `blocks.findLast((b) => b.kind === "prompt-select")` narrows to `PromptSelectBlock` via the
  discriminated union, so `.prompt` typechecks. If TS complains, use a typed predicate:
  `(b): b is PromptSelectBlock => b.kind === "prompt-select"` and import the type from `@/lib/blocks`.
- Memo identity matters: `promptBlock` must only change when `display` changes, otherwise `Composer`
  re-renders every poll.
- This is still a second parse of the same buffer (AnsiOutput does its own) — that was already true;
  do not try to lift AnsiOutput's parse out. Out of scope.

Then pass it to `Composer` (the JSX near line 940, beside `dialogPresent={dialogPresent}`):

```tsx
dialogPresent={dialogPresent}
promptBlock={promptBlock}
onPromptAction={handlePromptAction}
```

`handlePromptAction` (line ~379) is already a `useCallback` with the right signature
`(action: PromptBlockAction, prompt: PromptModel) => Promise<boolean>` and already handles read-only,
the frozen `shown.revision`, the status messages and the revalidate. **Do not duplicate any of it.**

### 2. `web/src/components/composer.tsx`

**Props.** Add two, both optional so the existing test mounts keep compiling:

```ts
/** The prompt dialog currently on screen (null when none, or when it isn't a prompt-select).
 *  Desktop mode's number keys pick from its options — through the same guard the buttons use. */
promptBlock?: PromptModel | null;
/** AgentChat's guarded prompt sender. Called with `{kind:"option"}` only; the feedback flow stays
 *  a button. */
onPromptAction?: (action: PromptBlockAction, prompt: PromptModel) => Promise<boolean>;
```

Imports: `import type { PromptModel } from "@/lib/blocks";` and
`import type { PromptBlockAction } from "@/components/prompt-select-block";` (no cycle —
`prompt-select-block.tsx` does not import the composer).

Destructure them in the props list on line ~161.

**Keydown.** The only edit is inside the existing `!direct.active` branch of `ChatInput`'s
`onKeyDown` (~line 999), after the desktop Enter handling and after the existing modifier/non-empty
early return, **before** the `PASS_THROUGH_KEYS` lookup:

```ts
if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || input.length !== 0) return;
// Desktop number keys answer a recognised prompt dialog. Routed through AgentChat's guarded
// handler — never `pressKeys`: a raw digit would go out unverified, and on a plan dialog whose
// text row has focus it would be typed into someone's half-written sentence (issue #95 /
// grammar/PLAN_FEEDBACK_NOTES.md). While a dialog is up the digit is consumed either way, so it
// can never land in the box or the pane by accident.
if (/^[0-9]$/.test(e.key)) {
  if (!dialogPresent) return; // no dialog: a digit is just a character
  e.preventDefault();
  if (!promptBlock || promptBlock.feedback?.focused) {
    setStatus("Use the buttons for this dialog", "warn");
    return;
  }
  const option = promptBlock.options.find((o) => o.keys[0] === e.key);
  if (!option) {
    setStatus(`No option ${e.key}`, "warn");
    return;
  }
  void onPromptAction?.({ kind: "option", option }, promptBlock);
  return;
}
const key = PASS_THROUGH_KEYS[e.key];
…
```

Do **not** add digits to `PASS_THROUGH_KEYS` — that map sends raw keys via `pressKeys`, which is
exactly what this must never do.

### 3. `web/src/lib/prompt-action.ts`

Only touch it if you genuinely need a lookup helper. You don't: `options.find(o => o.keys[0] === d)`
is one line at the call site. **Leave the file alone.**

### 4. `README.md` — "Desktop mode" section (~line 420)

Add one line after the "Composer / Direct" bullet list (before the "When typing directly…"
paragraph), phrased plainly:

```
**Number keys pick prompt options.** With the composer surface and an empty box, pressing an option's number answers a prompt dialog — the same checked send as tapping its button. A number with no matching option, or any other kind of dialog, does nothing and says so.
```

### 5. History and Files — §7 confirmation only, no code change

Verified 2026-08-23:

- `web/src/routes/history.tsx` has **no** `max-w-screen-sm` — line 283 documents that history has
  always been full-width, so desktop mode had nothing to drop.
- `web/src/routes/files.tsx:37` already swaps the cap out when `useDesktop().on`.

So §7 is done. Do not re-touch either route. Say so in the PR body, not in the code.

### 6. Version + changelog

Bump to **0.56.13** in all three, same number:

- `herdr-plugin.toml` line 3 `version = "0.56.13"`
- `package.json`
- `web/package.json`

`CHANGELOG.md` — new heading directly above `## [0.56.12]`:

```markdown
## [0.56.13] - 2026-08-23

### Added
- Desktop mode: number keys pick prompt options through the dialog guard
```

Use the real date on the day you build it. Per CLAUDE.md the entry should cite the feature commit's
short hash — land the code commit first, then the release commit citing it (`… (abc1234)`), the same
way 0.56.11/0.56.12 did.

## Tests — new files only, no existing test file edited

Baseline recorded 2026-08-23: `cd web && bun run test` → **154 files, 2834 passed, 19 todo (2853)**.
Root `bun run test` → **859**. Both must still pass, and every existing test file must be byte-identical
when you finish (`git status` should show no modification to any `*.test.*` that already existed).

### New: `web/src/components/composer-prompt-keys.test.tsx`

Copy the mount harness shape from `composer-desktop.test.tsx` (it already has `mount()`,
`StatusSentinel`, `__resetDesktop`/`setDesktop`, `clearStatus`). Build the `PromptModel` fixtures as
plain literals — no adapter needed at this level:

```ts
const prompt: PromptModel = {
  question: "Do you want to create hello.txt?",
  family: "permission",
  options: [
    { label: "Yes", keys: ["1"] },
    { label: "No", keys: ["2"] },
  ],
  coreSignature: "core",
  signature: "sig",
};
const planPrompt: PromptModel = {
  ...prompt,
  family: "plan",
  feedback: { key: "3", focused: false, text: "" },
};
```

Cases (each mounts with `setDesktop(true)` unless stated, `dialogPresent: true` unless stated, and a
`vi.fn()` `onPromptAction` resolving `true`):

1. **digit picks the option** — `fireEvent.keyDown(box, { key: "1" })` returns `false`
   (defaultPrevented) and `onPromptAction` was called once with
   `({ kind: "option", option: prompt.options[0] }, prompt)`. Box still empty.
2. **no raw key send** — assert with an MSW handler over `POST /api/pane/:id/keys` that records
   calls: it recorded nothing. (Use `server.use(...)` in the same style as `replyHandler` in
   `composer-desktop.test.tsx`.) This is the load-bearing assertion of the whole change.
3. **digit with no matching option** — `key: "9"` → status reads `No option 9`, `onPromptAction` not
   called, no keys POST, box still empty.
4. **plan dialog's text row digit** — with `planPrompt`, `key: "3"` → status `No option 3`, nothing
   sent, nothing typed. (The feedback row is never an option, so it can only ever fall here.)
5. **feedback row focused** — `{ ...planPrompt, feedback: { key: "3", focused: true, text: "" } }`,
   `key: "1"` → status `Use the buttons for this dialog`, `onPromptAction` not called.
6. **non-prompt dialog** — `dialogPresent: true`, `promptBlock: null` → `key: "1"` gives
   `Use the buttons for this dialog`, nothing sent.
7. **non-empty box types normally** — type `hi` first, then `key: "1"`: `onPromptAction` not called
   and the keydown is not prevented (`fireEvent.keyDown(...) === true`). Then `await user.type(box, "1")`
   → value `hi1`.
8. **no dialog on screen** — `dialogPresent: false`, `promptBlock: null` → keydown not prevented,
   `await user.type(box, "1")` leaves `1` in the box, nothing sent.
9. **`on: false` untouched** — `setDesktop(false)`, `dialogPresent: true`, `promptBlock: prompt`:
   keydown not prevented, `onPromptAction` not called, `user.type(box, "1")` → box holds `1`.
10. **direct typing armed still goes raw** — with desktop on, arm direct typing the way
    `composer-desktop.test.tsx` does, then a digit reaches the direct path (assert `onPromptAction`
    was not called). Keep this light; the direct pump has its own tests.

### New: `web/src/components/agent-chat-prompt-keys.test.tsx`

Wired end of the seam — that `promptBlock` really is derived from the pane buffer and really reaches
`submitPromptOption`. Model it on `agent-chat.test.tsx`'s `MENU_TEXT` fixture and its
`vi.mock("@/lib/prompt-action", …)`, and on `agent-chat-desktop.test.tsx`'s `setDesktop`/`show()` shape:

1. Desktop on, `writeDisplayPrefs({ rawTerminal: false })` (grammars must be on for blocks to exist),
   pane text = a permission dialog (`❯ 1. Yes` / `2. No` + the Esc/Tab footer). Focus the composer
   textarea, `fireEvent.keyDown(box, { key: "2" })` → mocked `submitPromptOption` called once with
   `option.label === "No"` and `detectedRevision` equal to the rendered revision.
2. Same mount, `key: "7"` → `submitPromptOption` not called, status `No option 7`.
3. A wizard buffer (`WIZARD_TEXT` shape) with desktop on → `key: "1"` gives
   `Use the buttons for this dialog` and `submitWizardKeys` / `submitPromptOption` are not called.

Vitest globals are on in this project (`describe`/`it`/`vi` are used without import in
`agent-chat.test.tsx`); follow whichever style the file you are copying uses.

## Verify (judge by exit status, not by grepping output)

```bash
cd "C:/claudeOS/Projects/tools/collie"
bun run typecheck                 # root + web tsc, must be clean
(cd web && bun run test)          # 154 files, ≥2834 passing + your new ones
bun run test                      # root, 859
bash scripts/check-doc-links.sh   # README anchor check
bash scripts/check-version.sh     # must print ✓ after the bump
git status --short                # no pre-existing *.test.* file modified
```

`bun run build` at the root typechecks both sides and swaps `web/dist` atomically — run it if you
want the deployed bundle refreshed, but it is not required for the PR.

## Then

1. Commit the functional change on `feat/desktop-views` (message: `Desktop mode: number keys pick prompt options`).
2. Commit the release separately: version bump in the three files + the CHANGELOG entry citing the
   first commit's short hash.
3. `git push` (the pre-push hook runs both suites; on Windows the ctl suite takes the PowerShell branch).
4. `gh pr create` — in the body, note that §7 (History/Files width) was already satisfied and needed
   no code, and list the manual check: open a Claude permission prompt in a real pane with desktop
   mode on and raw terminal off, press `1`, confirm the pane answers and nothing was typed into the box.
5. After the operator merges, tag: `git tag -a v0.56.13 -m "Collie 0.56.13" && git push origin v0.56.13`.

## Out of scope — do not touch

- `web/src/hooks/use-display-prefs.ts`
- `bridge/` (any file)
- `web/src/hooks/use-long-press.ts`
- `web/src/hooks/use-direct-typing.ts`
- `web/src/lib/dialog-guard.ts`
- `web/src/lib/prompt-action.ts` (no helper is needed)
- Any existing test file
- Lifting AnsiOutput's own parse, a two-column Files view, or anything else from the spec's §8

## Traps

- **Never `pressKeys([digit])`.** The whole point of the change is that the digit goes through
  `submitPromptOption`'s fresh-read + signature check. A raw send would bypass it.
- The plan dialog's text row digit is *not* in `options` (the adapter drops it), so the `find` miss is
  what protects it. Test 4 pins that; don't "helpfully" add the feedback row to the lookup.
- `preventDefault()` only when a dialog is present. Preventing a digit with no dialog would stop
  people typing numbers in ordinary messages.
- Keep the memo dependencies exactly `[display, agent?.agent, grammarsOn]` on `blocks` and `[blocks]`
  on the two derivations, or the composer re-renders on every poll.
- The request pins **PATCH 0.56.13** with an `### Added` line. `scripts/check-version.sh` only checks
  that the four places agree, so follow the request as written rather than promoting the bump.
