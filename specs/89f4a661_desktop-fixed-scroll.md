# Plan — desktop mode: fixed layout, exactly two scroll regions

**Chunk:** desktop phase 2a (`requests/desktop-2a-scroll.md`)
**Spec:** `specs/desktop-mode-spec.md` §2a. The "Decisions" table in that spec is settled — do not
re-open it.
**Version:** 0.56.2 → **0.56.3** (PATCH)
**Baseline commit:** `3ce34b7`. `git diff 3ce34b7..HEAD -- web/src/` is **empty**, so every file you
touch is already exactly what it was at `3ce34b7`. "Unchanged on the phone" therefore means: do not
alter any class string that is not behind a `desktop` branch.

## What this does

In desktop mode the app should be a fixed frame. Right now it is not: the page scrolls, which drags
the pane header off the top and the composer off the bottom on a long pane. After this change, when
`useDesktop().on` is true:

- the page itself never scrolls (`html` / `body` / `#root` are 100 dvh, `overflow: hidden`);
- the off-ramp strip, the sidebar, the pane `AppHeader`, the statusline strip and the composer /
  direct-typing strip are always on screen;
- the only scrollers are the **pane mirror**, the **History transcript**, and the **sidebar's space
  tree** (its own box, as §2a allows).

When `on` is false nothing changes at all.

## Why it is broken today (read this before editing)

Three links in the height chain are missing, and each one on its own is enough to let the page grow:

1. **`DesktopShell` is a grid with implicit rows.** `grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]`
   has no `grid-template-rows`, so both rows are `auto`. An auto row grows past a definite container
   height instead of clipping — 500 mirror lines push row 2 taller than the grid.
2. **The `<Outlet/>` wrapper is a block, not a flex column.** `<div className="min-w-0 min-h-0">`
   holds route roots that are all `flex min-h-0 flex-1 flex-col`. `flex-1` inside a *block* parent
   does nothing, so the route root's height falls back to `auto` (content height). Its inner
   `overflow-y-auto` box then resolves `h-full` against an auto-height parent and never scrolls — it
   just grows. This is why the pane mirror, the History transcript, Settings and Traces all push the
   page down today.
3. **Nothing caps `body` / `#root`.** `RootLayout`'s `h-[100dvh]` column has no `overflow-hidden`, so
   whatever overflows it spills into a body that has no height cap.

Fix all three and the existing scrollers (`ChatMessageList` already carries `overflow-y-auto`; the
sidebar tree box already carries `min-h-0 flex-1 overflow-y-auto`) start working as intended. Almost
nothing new needs to be written — this is a containment fix, not a new layout.

## Decisions taken here (do not re-litigate mid-build)

| Question | Decision |
|---|---|
| Where does the "page can't scroll" rule live? | One unlayered CSS rule in `index.css` keyed on `html.collie-desktop`, plus a desktop-gated `overflow-hidden` on `RootLayout`'s 100 dvh column. Tailwind classes can't reach `body`/`#root`, so a CSS rule is required — this is the "only if a desktop-gated rule is needed" case the request allows. |
| Who adds/removes the `collie-desktop` class? | `DesktopShell`, in a `useEffect` with a cleanup. It mounts **only** when the switch is on, so the gate is structural — no `if (desktop)` to get wrong, and the class can't outlive desktop mode. |
| `routes/history.tsx` | **No code change.** Its shape is already `flex min-h-0 flex-1 flex-col` → sticky `AppHeader` → `relative min-h-0 min-w-0 flex-1` → `ChatMessageList` (the one `overflow-y-auto`). Once fix #2 lands it behaves correctly. Add the test file only. |
| Prompt buttons | They stay rendered inline in the mirror (inside `AnsiOutput`), which auto-follows the tail — that is what "always on screen" means here. Do **not** lift them into the fixed bottom region: that would change `blocks.ts` / `ansi-output.tsx` / the phone, all out of scope. |
| Settings / Traces / Files / tree routes | Already own an internal `overflow-y-auto` (or `overflow-auto`) box under a `flex min-h-0 flex-1 flex-col` root. Fix #2 makes those work; no per-route edits. |
| Sidebar width / resizing | Untouched. Out of scope. |

## Files to change

### 1. `web/src/index.css` — the page-can't-scroll rule

Add **after** the closing `}` of the `@layer base { … }` block (around line 222, right before the
`view-transition-name` rule). Unlayered on purpose, so it wins over the `@layer base` `html`/`body`
rules without `!important`.

```css
/* ── Desktop mode is a fixed frame ───────────────────────────────────────────────────────────────
   Desktop mode has exactly two scroll regions — the pane mirror and the History transcript (plus the
   sidebar's own tree box). The page itself must never scroll, or the fixed pane header scrolls off
   the top and the composer off the bottom on a long pane (spec §2a). Tailwind can't reach body/#root,
   so this lives here. The class is added by DesktopShell, which mounts only while the desktop switch
   is on — the phone never matches this selector. */
html.collie-desktop,
html.collie-desktop body,
html.collie-desktop #root {
  height: 100dvh;
  overflow: hidden;
}
```

### 2. `web/src/components/desktop-shell.tsx` — rows, containment, the html class

Three edits to the existing component.

- Import `useEffect` from `react` and add, above the `return`:

```tsx
  // The <html>/<body>/#root cap for desktop mode (index.css, `html.collie-desktop`). Scoped to this
  // component's lifetime rather than to a `desktop` boolean somewhere else: DesktopShell mounts only
  // while the switch is on, so the class can never outlive desktop mode — including when the idle
  // pause swaps the whole router out.
  useEffect(() => {
    document.documentElement.classList.add("collie-desktop");
    return () => document.documentElement.classList.remove("collie-desktop");
  }, []);
```

- Grid container — add explicit rows and clip:

```tsx
  // grid-rows: the off-ramp strip is `auto`, the sidebar+pane row is `minmax(0,1fr)`. Without the
  // explicit rows both tracks are `auto` and a long pane grows the second one past the viewport
  // instead of making the mirror scroll.
  <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
```

- Outlet wrapper — a flex column, so each route root's `min-h-0 flex-1` has something to resolve
  against:

```tsx
    {/* A flex column, not a block: every route root is `flex min-h-0 flex-1 flex-col` and owns its
        own scroller inside. In a block parent that `flex-1` is inert, the route grows to content
        height, and its `h-full` scroller never scrolls — that is the bug this fixes. */}
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden"><Outlet /></div>
```

Leave the off-ramp strip line exactly as it is.

### 3. `web/src/components/desktop-sidebar.tsx` — pin the ends, scroll only the tree

Desktop-only component, so no gating needed.

- `aside`: `flex min-h-0 flex-col border-r-2 border-border bg-muted` → add `overflow-hidden`.
- The Collie / session-switcher header `div`: add `shrink-0`.
- The `<nav aria-label="Desktop navigation">`: add `shrink-0`.
- The tree box (`min-h-0 flex-1 overflow-y-auto`) is already correct — leave it.

Short comment on the aside: `// Ends are pinned; only the tree box scrolls (spec §2a).`

### 4. `web/src/components/agent-chat.tsx` — two desktop-gated class changes

- Outer wrapper (the `desktop ? … : …` ternary at ~line 603). Change **only the desktop branch**:

  `"flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden"`
  → `"flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"`

  Extend the comment above it: `overflow-x-hidden` computes `overflow-y` to `auto` (the CSS quirk
  already noted further down this file), which makes this element a second vertical scroller
  competing with the mirror. In desktop mode it must clip on both axes. The phone branch keeps
  `max-w-[100dvw] … overflow-x-hidden` verbatim.

- Bottom region (`<div className="relative">` at ~line 847, holding the swipe handle, statusline
  strip and `<Composer/>`):

```tsx
        {/* shrink-0 on desktop: the mirror above is `flex-1`, and this band must never be squeezed
            by it — the statusline strip and the composer are fixed chrome (spec §2a). */}
        <div className={cn("relative", desktop && "shrink-0")}>
```

  `cn` is already imported in this file. On the phone the class list stays exactly `"relative"` —
  `cn("relative", false && …)` returns `"relative"`.

Change nothing else in this file. In particular leave `<div className="min-h-0 min-w-0 flex-1 border-t border-border/40">`
(the mirror wrapper) and `<StatusArea className="mx-3 mt-1.5 shrink-0" />` alone.

### 5. `web/src/routes/root.tsx` — clip the app column on desktop

- Add `import { cn } from "@/lib/utils";`.
- `<div className="flex h-[100dvh] flex-col">` → 

```tsx
    // overflow-hidden on desktop only: with the page cap in index.css this is belt and braces, but it
    // is what stops a route that misses its own min-h-0 from spilling into a scrolling body.
    <div className={cn("flex h-[100dvh] flex-col", desktop && "overflow-hidden")}>
```

  `const desktop = useDesktop().on;` already exists above the return. Leave `BootSplash` and
  `RootError` (their own `h-[100dvh]` divs) untouched.

### 6. `web/src/routes/history.tsx` — no code change

Verify only. If the History test below passes without an edit, ship it unedited. If you find you do
need something, the **only** permitted change is a desktop-gated `overflow-hidden` on the root
`<div className="flex min-h-0 flex-1 flex-col">` — nothing else in that file.

## Tests

Five **new** files. Do not edit any existing test file. Copy setup from the neighbours named below.

All of them must reset the store: `beforeEach(() => __resetDesktop())` /
`afterEach(() => __resetDesktop())`, and `setDesktop(true)` inside the desktop cases.

### `web/src/components/desktop-shell-scroll.test.tsx`
Model the render on `components/desktop-shell.test.tsx` (same `HomeData` fixture, same
`createMemoryRouter` shape with a stand-in child element).

- desktop on: `document.documentElement.classList.contains("collie-desktop")` is `true`; after
  `unmount()` it is `false`.
- the grid element (`screen.getByText(/Desktop mode is on/).closest("div.grid")`) has classes
  `grid-rows-[auto_minmax(0,1fr)]` and `overflow-hidden`.
- the outlet wrapper (`screen.getByText("pane stand-in").parentElement`) has `flex`, `flex-col`,
  `min-h-0`.
- phone: rendering `RootLayout` from `routes/root.tsx` with desktop **off** (mock the hooks the way
  `routes/root-desktop.test.tsx` does) leaves `document.documentElement` without `collie-desktop`.

### `web/src/components/desktop-sidebar-scroll.test.tsx`
Model on `components/desktop-sidebar.test.tsx`.

- the `<aside>` has `min-h-0` and `overflow-hidden`;
- `container.querySelectorAll(".overflow-y-auto")` has length **1**, and that element contains the
  space tree;
- the `Desktop navigation` nav has `shrink-0`.

### `web/src/components/agent-chat-scroll.test.tsx`
Model on `components/agent-chat-desktop.test.tsx` (same `fixtureAgents[0]`, same
`Element.prototype.scrollTo = () => {}` stub in `beforeEach`). Render with 500 lines:

```tsx
const text = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
```

With `setDesktop(true)`:
- exactly one element in the container carries `overflow-y-auto` — that is the mirror box;
- that element does **not** contain the header (`container.querySelector("header")`) and does **not**
  contain the composer input (`screen.getByPlaceholderText(/type a reply/i)`) — i.e. the fixed chrome
  is outside the scroller;
- the header and the composer input are both still in the document (a 500-line pane does not push
  them out);
- the outer wrapper (`container.firstElementChild`) has `overflow-hidden` and does **not** have
  `max-w-[100dvw]`;
- the bottom region (the composer input's nearest `div.relative` ancestor that is a child of the
  content column — reach it with `screen.getByPlaceholderText(/type a reply/i).closest("div.relative")`
  and walk up if needed; simplest reliable handle: `container.querySelector("div.relative.shrink-0")`)
  has `shrink-0`.

With desktop **off** (same 500 lines), pin the phone class lists verbatim:
- `container.firstElementChild.className` is exactly
  `"flex min-h-0 w-full min-w-0 max-w-[100dvw] flex-1 flex-col overflow-x-hidden"`;
- `container.querySelector("div.relative.shrink-0")` is `null`, and the bottom region's `className`
  is exactly `"relative"`.

### `web/src/routes/history-desktop.test.tsx`
Model the loader/router setup on `routes/history.test.tsx`. With `setDesktop(true)` and a transcript
of several turns:
- `container.querySelectorAll(".overflow-y-auto")` has length **1**;
- that element contains the transcript turns and does **not** contain the route's `<header>`.

### `web/src/routes/root-scroll.test.tsx`
Model on `routes/root-desktop.test.tsx` (same `vi.mock` list for `use-polling`, `use-transitions`,
`use-push`, `use-poll-busy`, the two banners).
- desktop off: the layout root's `className` is exactly `"flex h-[100dvh] flex-col"`;
- desktop on: it contains `overflow-hidden`.

## Version bump — mandatory, PATCH

Same number in all three, plus the CHANGELOG entry:

- `herdr-plugin.toml` → `version = "0.56.3"`
- `package.json` → `"version": "0.56.3"`
- `web/package.json` → `"version": "0.56.3"`
- `CHANGELOG.md` — new heading directly above `## [0.56.2] - 2026-08-22`:

```markdown
## [0.56.3] - 2026-08-22

### Changed
- Desktop mode: only the mirror and History scroll; sidebar, header and composer stay fixed
```

(Repo style cites the feature commit's short hash at the end of the line. Land the functional commit
first, then add the hash if you cut the release as a separate commit; a single combined commit ships
the line without a hash.)

Then run `bash scripts/check-version.sh` — it must print `✓`.

## Verification — run all of these

```bash
cd web && bun run test          # expects 129 files, 2702 passed | 19 todo  PLUS your new tests
cd .. && bun run test           # must still report 859 tests (bridge is untouched)
bun run typecheck               # root tsc, clean
cd web && bun run typecheck     # web tsc, clean (also runs as part of `bun run test`)
bash scripts/check-version.sh   # ✓
```

Baselines measured on this checkout at `3ce34b7`/HEAD before any edit:

- `web`: **129 test files, 2702 passed | 19 todo (2721)** — your five new files add to this; no
  existing count may drop.
- root: **859 tests** — `bridge/` and `scripts/` are untouched, so this number must not move.

`web/bun run test` runs `bun run typecheck && vitest run`, so a type error fails the suite.

Manual sanity check on the desktop browser after `bun run build`:
1. Settings → Desktop mode on. Open a pane with a lot of output. The pane header, the statusline
   strip and the composer stay put; only the terminal text moves. There is no browser scrollbar on
   the page.
2. Open History from that pane — same shape, the transcript scrolls under a fixed header.
3. Collapse the window until the sidebar tree overflows — the tree scrolls inside the sidebar, the
   Spaces/Traces/Files/Settings nav stays pinned to the bottom.
4. Turn desktop mode off. The phone layout is byte-for-byte what it was: bottom nav, swipe handle,
   page scrolls as before.

## Out of scope — do not touch

`web/src/hooks/use-display-prefs.ts` · anything under `bridge/` ·
`web/src/hooks/use-direct-typing.ts` · `web/src/hooks/use-long-press.ts` ·
`web/src/components/composer.tsx` · sidebar resizing · any phone layout change ·
`web/src/components/app-header.tsx`, `ui/chat/chat-message-list.tsx`, `ansi-output.tsx`,
`lib/blocks.ts` (they are already the right shape).

## Git

Branch off `main`: `feat/desktop-scroll-regions`. One functional commit + the release bump, push,
`gh pr create`. The operator merges. Because this is a release on `main`, push the matching annotated
tag with it: `git tag -a v0.56.3 -m "Collie 0.56.3" && git push --follow-tags`.
