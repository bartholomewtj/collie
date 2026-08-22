# Plan — desktop mode: drag-and-drop image upload (phase 3 remainder)

**Repo:** `C:\claudeOS\Projects\tools\collie` (Windows checkout, Git Bash)
**Version:** 0.56.10 → **0.56.11** (PATCH)
**Spec:** `specs/desktop-mode-spec.md` §4 (Mouse, phase 3) and §10 phase 3 row.
**Branch:** `feat/desktop-drop-upload` → push → `gh pr create` → operator merges.

## What to build

In desktop mode (`useDesktop().on === true`) with a pane open, dragging an image file from the OS
onto the Collie window uploads it to that pane and offers the returned host path as the existing
one-click **"Type path"** chip. Nothing is typed into the terminal until the operator clicks the
chip. With `on: false` nothing is registered at all and a drop behaves exactly as it does today.

Right-click popovers (the other half of phase 3) already shipped in 0.56.10. This is the last item
in that row.

## Decisions already made — do not re-open

From the spec's Decisions table and §4/§5:

- Image send on desktop is paste + drag-and-drop. The attach button stays hidden.
- No `bridge/` change of any kind.
- The upload result is **never typed unprompted** — the chip is the consent step.
- Armed state for direct typing is never persisted and is not lifted anywhere.

## What is true in the code today (verified 2026-08-23 — re-check line numbers, they drift)

- **`lib/paste-hold.ts` already exists** and is exactly the store this needs:
  `PasteHold = {kind:"text",…} | {kind:"path", path, onSend, onDiscard}`, with `setPasteHold`,
  `clearPasteHold`, `pasteHold()`, `usePasteHold()` and `__resetPasteHold()`.
- **`components/direct-typing-strip.tsx` already renders the chip**: when `!disabled` and
  `hold.kind === "path"` it shows `Image added — <path>` plus a **"Type path"** button (calls
  `hold.onSend`) and a **"Discard"** button (calls `hold.onDiscard`). Nothing new is needed there.
- **`hooks/use-direct-typing.ts` (~line 368–400)** already does the equivalent for a *clipboard*
  image paste while armed: it uploads via an injected `uploadImage` option defaulting to
  `api.uploadImage(paneId, file, session)`, then `setStatus(...)` + `setPasteHold({kind:"path", …})`
  whose `onSend` clears the hold and enqueues `textToKeySequence(path)`. **Copy this shape.**
- **`components/composer.tsx`**
  - `uploadImage(file)` (~line 721) is the symbol `onPasteImage` (~line 752) calls. It is a
    *component-local* function, not exported: it calls `api.uploadImage(paneId, file, session)`,
    then appends `res.path` to the composer draft. "Reuse its upload path" therefore means reuse
    **`api.uploadImage(paneId, file, session)`** — the same call, the same seam
    `use-direct-typing.ts` already defaults to. Do not export composer internals.
  - `pressKeys(k: string[])` (~line 695) is the raw key transport (`api.sendKeys` + revalidate,
    refuses when `locked`).
  - `ComposerHandle` (~line 40) currently exposes `focusInput`, `armDirect`, `releaseDirect`,
    `toggleDirect`. No test file constructs one, so adding a method is safe.
  - `showDesktopStrip` (~line 363) is
    `desktop && (direct.active || (typing === "direct" && stripReason !== null))`, and the strip is
    rendered at ~line 1063 with `disabled={!direct.active}`. **So today a path hold is invisible
    unless direct typing happens to be armed** — that gap has to be closed here, or the chip the
    spec asks for never appears after a drop on the composer surface.
- **`components/agent-chat.tsx`** has `paneId`, `session`, `gone = !agent`, `readOnly`,
  `const { on: desktop, typing } = useDesktop()` (~line 136) and `composerRef` (~line 144). Its
  existing capture-phase `pointerdown` effect (~line 603) is the local pattern for a window listener.
- **`hooks/use-desktop-hotkeys.ts`** is the local pattern for "stable listener + `latest` ref so
  polling replacements don't tear it down".
- **Baselines measured 2026-08-23:** `cd web && bun run test` → **153 files, 2829 passed, 19 todo**.
  Root `bun run test` → **859**. Both must still pass; the web numbers go up only by the new file.

## Files to touch

| File | Change |
|---|---|
| `web/src/hooks/use-drop-upload.ts` | **New.** The window `dragover`/`drop` listeners + upload. |
| `web/src/hooks/use-drop-upload.test.tsx` | **New.** The four cases in "Done means". |
| `web/src/components/agent-chat.tsx` | Mount the hook; build the `kind:"path"` hold. |
| `web/src/components/composer.tsx` | `ComposerHandle.typePath`; make a path hold show the strip. |
| `herdr-plugin.toml`, `package.json`, `web/package.json` | `0.56.10` → `0.56.11`. |
| `CHANGELOG.md` | One `### Added` line under `## [0.56.11] - 2026-08-23`. |

**Out of scope — do not open:** `web/src/hooks/use-display-prefs.ts`, anything under `bridge/`,
`web/src/hooks/use-long-press.ts`, `web/src/components/pane-actions-sheet.tsx`. **No existing test
file may be edited.**

## 1. `web/src/hooks/use-drop-upload.ts` (new)

```ts
import { useEffect, useRef } from "react";
import * as api from "@/lib/api";
import { setStatus } from "@/lib/status";

export interface DropUploadArgs {
  /** Register the listeners at all. False in phone mode, on a gone pane, on a read-only device. */
  enabled: boolean;
  paneId: string;
  session?: string;
  /** Called with the saved host path. The caller decides what the path DOES — this hook never types. */
  onPath: (path: string) => void;
  /** Test seam / override. Defaults to the pane upload endpoint. */
  uploadImage?: (file: File) => Promise<string | null>;
}

export function useDropUpload({ enabled, paneId, session, onPath, uploadImage }: DropUploadArgs): void
```

Rules the implementation must follow — each one is a comment worth writing down at the line:

1. **`if (!enabled) return;` before any `addEventListener`.** With `on: false` there is no listener
   on `window` at all, so a drop keeps whatever the browser does today. This is the phone-unchanged
   guarantee from spec §9; don't turn it into a "registered but early-returns" listener.
2. Both listeners go on `window`, plain bubble phase (no capture), and both call
   `event.preventDefault()` **unconditionally while enabled**. `dragover` must preventDefault or the
   browser never fires `drop` at all; `drop` must preventDefault or a stray file/URL drop navigates
   the page away from a live terminal. That is the "a stray drop never navigates" line in the spec.
3. Read `const files = Array.from(event.dataTransfer?.files ?? [])`. **`files.length === 0` → return
   silently** — that is a text/URL/selection drop: no upload, no status, no hold, no keys. (The
   default was still prevented; that is the point of rule 2.)
4. `const image = files.find((f) => f.type.startsWith("image/"))`. If there is none:
   `setStatus("Only images can be dropped", "error")` and return. Nothing is uploaded.
5. Otherwise upload the **first** image file only. Multi-file drops take `find`'s first match;
   don't loop.
6. Default uploader (used when `uploadImage` is not supplied), mirroring `use-direct-typing.ts`:
   ```ts
   const res = await api.uploadImage(paneId, file, session);
   if (!res.ok) { setStatus(res.error ?? "Image upload failed.", "error"); return null; }
   return res.path;
   ```
   wrapped in `try/catch` → `setStatus(message, "error")`, return `null`.
7. On a non-null path: `setStatus("Image uploaded — click Type path to insert it", "success")` then
   `onPath(path)`. On `null`: nothing else happens (the uploader already reported).
8. `onPath` and `uploadImage` go through a `latest` ref (`latest.current = { onPath, uploadImage }`
   assigned during render, as `use-desktop-hotkeys.ts` does) so the effect deps are only
   `[enabled, paneId, session]` and a re-render from polling never re-registers the listeners.
9. Cleanup removes both listeners.
10. The hook returns `void` and imports nothing from `paste-hold` — it does not know what a chip is.

## 2. `web/src/components/agent-chat.tsx`

Add the import and mount it near the existing `pointerdown` effect:

```tsx
import { useDropUpload } from "@/hooks/use-drop-upload";
import { clearPasteHold, setPasteHold } from "@/lib/paste-hold";

useDropUpload({
  enabled: desktop && !gone && !readOnly,
  paneId,
  session,
  // The path is OFFERED, never typed: the chip's click is the consent step (spec §3/§4).
  onPath: (path) =>
    setPasteHold({
      kind: "path",
      path,
      onSend: () => { clearPasteHold(); composerRef.current?.typePath(path); },
      onDiscard: () => { clearPasteHold(); },
    }),
});
```

`enabled` deliberately does **not** depend on `typing` or on whether direct typing is armed: the
spec's condition is "`on` and a pane is open". A locked pane (gone / read-only) accepts no drop
because it accepts no write.

## 3. `web/src/components/composer.tsx`

Two small changes.

**(a) `typePath` on `ComposerHandle`** — the one thing the chip needs that lives only in the
composer (the key transport):

```ts
export interface ComposerHandle {
  …
  /** Type an uploaded host path into the pane — the "Type path" chip's action. Never called on its own. */
  typePath: (path: string) => void;
}
```

In `useImperativeHandle`:
`typePath: (path) => { void pressKeys(textToKeySequence(path)); focusInputImmediately(); }`.
Import `textToKeySequence` from `@/lib/key-queue`. `pressKeys` already refuses while `locked`, so a
pane that went away between the drop and the click sends nothing.

**(b) Make a path hold visible when direct typing is not armed.** Without this the chip only ever
appears if the operator happened to already be armed, which is not what the spec asks for.

```ts
const hold = usePasteHold();                       // import { usePasteHold } from "@/lib/paste-hold"
const pathHold = desktop && hold?.kind === "path" && stripReason === null;
const showDesktopStrip = desktop && (direct.active || pathHold || (typing === "direct" && stripReason !== null));
```

and at the render site change `disabled={!direct.active}` to `disabled={!direct.active && !pathHold}`.

Behaviour this produces, and it is intended: after a drop on the composer surface the strip
temporarily covers the textarea (the textarea already goes `opacity-0` under `showDesktopStrip`)
showing `Image added — /host/path.png` with **Type path** and **Discard**. Discard clears the hold
and the composer comes straight back. Nothing about the phone path (`desktop === false`) changes —
every clause is behind `desktop`.

## 4. `web/src/hooks/use-drop-upload.test.tsx` (new)

`jsdom` has no `DragEvent` and no constructible `DataTransfer`, so build the events by hand rather
than trusting `fireEvent.drop`'s fallback — you need the returned event object anyway to assert
`defaultPrevented`:

```tsx
function dispatch(type: "dragover" | "drop", files: File[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types: files.length ? ["Files"] : ["text/plain"] },
  });
  window.dispatchEvent(event);
  return event;
}
```

A tiny probe component mounts the hook with an injected `uploadImage`
(`vi.fn(async () => "/host/shot.png")`, so you can assert call counts) and renders
`<DirectTypingStrip onStop={vi.fn()} />` so the chip is assertable straight from the store — this is
exactly how `components/direct-typing-strip-paste.test.tsx` already tests the path hold. `onPath` in
the probe sets the hold the same way `agent-chat.tsx` does, with a `vi.fn()` standing in for
`typePath`.

Drive `enabled` as a plain prop on the probe — the hook takes a boolean, so the test needs neither
`lib/desktop` nor a router. `beforeEach`: `__resetPasteHold()`. `afterEach`: `cleanup()`,
`__resetPasteHold()`.

The four cases:

1. **`enabled: true`, image file drop** — `dispatch("dragover", [png]).defaultPrevented === true`
   and `dispatch("drop", [png]).defaultPrevented === true`; `await waitFor` the uploader to have
   been called once with the file; the **"Type path"** button is in the document; the `typePath`
   spy has **not** been called (nothing typed unprompted). Also assert `Discard` is present and that
   clicking `Type path` calls the spy once.
2. **Text drop** (`files: []`) — uploader not called, `pasteHold()` still `null`, no status,
   `typePath` spy not called. (Assert the absence, not `defaultPrevented`.)
3. **Non-image file** (`new File(["x"], "notes.txt", { type: "text/plain" })`) — the status store
   holds `Only images can be dropped` (read it with the store getter exported from `@/lib/status`;
   mounting `StatusArea` also works but is more machinery), uploader not called, no hold.
4. **`enabled: false`** — assert no listener is attached: `vi.spyOn(window, "addEventListener")`
   before render and expect no `"drop"` / `"dragover"` registration, **and**
   `dispatch("drop", [png]).defaultPrevented === false`, uploader not called.

Give the file a `describe("useDropUpload", …)` and keep each assertion in an `it(...)` — the repo
style is dense one-line tests, follow it.

## 5. Version + changelog

Bump `0.56.10` → **`0.56.11`** in all three of `herdr-plugin.toml` (line 3), `package.json`
(line 3), `web/package.json` (line 3). Add to `CHANGELOG.md` immediately above `## [0.56.10]`:

```markdown
## [0.56.11] - 2026-08-23

### Added
- Desktop mode: drag an image onto the pane to upload it; the host path appears as a Type path chip
```

Cite the feature commit's short hash at the end of the line if you land the feature commit first
(repo convention); otherwise leave the line exactly as written above.

Then `bash scripts/check-version.sh` must print `✓`.

## Verify

Run all of these from the repo root in Git Bash and judge each by its **exit status**:

```bash
bash scripts/check-version.sh          # prints ✓
bun run typecheck                      # root tsc, clean
cd web && bun run test && cd ..        # typecheck + vitest: 154 files, 2829 + new, 19 todo
bun run test                           # 859, unchanged
```

`web/package.json`'s `test` script already runs `typecheck` first, so the third line covers both.
`bun run build` is not required for the PR, but if you run it, it typechecks both sides and swaps
`dist` atomically.

Manual smoke (optional, needs the bridge running): Settings → Desktop mode on, open a pane, drag a
PNG from Explorer onto the window → the strip shows `Image added — <path>` with Type path /
Discard; click Type path → the path is typed into the pane with no trailing Enter. Drag a `.txt` →
status says `Only images can be dropped`. Turn Desktop mode off, drag the same PNG → the browser
opens it in place (today's behaviour).

## Done means

- New tests cover, with `enabled: true`, that a file drop is `defaultPrevented` on both `dragover`
  and `drop`, uploads the image and shows the "Type path" chip without sending keys.
- A text drop does nothing; a non-image file shows `Only images can be dropped` and uploads nothing.
- With `enabled: false` no listener is attached and `drop` is not `defaultPrevented`.
- `cd web && bun run test` passes, **no existing test file edited**; root `bun run test` still 859;
  `bun run typecheck` clean.
- `0.56.11` in the three version files, one `### Added` CHANGELOG line, `check-version.sh` green.
- Branch pushed and `gh pr create` opened; the operator merges. Tag `v0.56.11` on merge
  (`git push --follow-tags`).

## Traps

- **Don't preventDefault only on file drops.** A URL drop navigating away from a live terminal is
  the exact hazard §4 names; prevent both events unconditionally while enabled.
- **Don't type the path.** The upload result goes into the hold and stops there.
- **Don't touch `use-display-prefs.ts` or `bridge/`.** The upload endpoint already exists.
- **Don't add a second drop target** (a drop-zone component, a highlight overlay). The spec asks for
  window-level listeners and nothing visual beyond the existing strip.
- **Don't edit an existing test file** — the phone-unchanged acceptance test in spec §9 depends on
  every current test passing verbatim.
