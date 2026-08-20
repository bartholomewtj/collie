# Plan — Clean word wrapping on the Collie mobile mirror (grok, agy, claude)

Request: `requests/smart-wrap.md`. Wrap stays ON by default and prose still wraps; table,
box-drawing and full-width-highlight rows stop wrapping into stacked fragments (they clip like the
existing long `─` / `╭─╮` borders); trailing padded spaces stop wrapping into extra coloured rows.
Same toggle, same agents, no new settings. Out of scope: pane resize, markdown parsing, history,
changing the wrap default, per-agent wrap settings, a terminal emulator.

## Where the change lives, and why (read first)

- **The classifier must be agent-neutral, so it lives in the core AST (`web/src/lib/blocks.ts`), not
  in any harness adapter.** agy has no adapter (see `web/src/lib/harness/registry.ts` — only claude,
  grok, omp are registered), so the core module is the only place that reaches all three agents.
  Nothing may be added to `harness/claude`, `harness/grok`, etc.
- **The trailing-space strip must run AFTER `buildBlocks`, not inside `splitLines`.** `splitLines`
  output is consumed by the reply guard (`lib/harness/guard.ts`), the draft/statusline extractors
  (`components/agent-chat.tsx`) and every dialog grammar — all of which rely on byte-fidelity of the
  pane text. Stripping inside `splitLines` would silently change what those safety-critical
  detectors see. So: `splitLines` keeps its byte-exact contract; a new pure presentation pass runs
  between `buildBlocks` and the render.
- **Move the existing border classifiers out of `styledLine` into that same pass.** `noWrap` is
  consumed only by the renderer (`components/ansi-output.tsx`). Leaving border classification in
  `styledLine` while the new classes live in a second site would split wrap policy across two
  places for no reason. Consequence: `splitLines` becomes a pure split again, and the existing
  `noWrap` tests in `blocks.test.ts` move from `splitLines(...)` to the new function (same
  assertions, new call site).
- **The renderer's clip branch already exists** (`line.noWrap && wrap` → `inline-block max-w-full
  overflow-hidden` span in `ansi-output.tsx`). The renderer change is one line: wrap the
  `buildBlocks` result in the new pass. Don't touch the clip markup, the wrap-off branch, or
  `preClass`.

## Design: the presentation pass

New pure functions in `web/src/lib/blocks.ts`, exported:

- `presentLine(line: StyledLine): StyledLine` — classify + strip one line.
- `presentLines(lines: StyledLine[]): StyledLine[]` — map (returns the same array/object references
  when nothing changed, to keep the polling path cheap).
- `presentBlocks(blocks: Block[]): Block[]` — map `kind: "raw"` and `kind: "menu"` blocks to new
  block objects with presented `lines`; pass dialog blocks (`prompt-select`, `wizard`,
  `preview-select`, `multi-select`) through untouched (their `lines` are provenance, never rendered
  as text). Menu-block lines get the strip for mirror consistency; `MenuBlock`'s `<pre>` is
  `whitespace-pre overflow-x-auto` so `noWrap` is inert there by design.

`presentLine` does, in order (classify on the ORIGINAL text — the strip destroys padding evidence):

1. **Existing border classifiers, unchanged in behaviour:** `PURE_HORIZONTAL_BORDER` and
   `ROUNDED_BOX_BORDER` on the trimmed line text (move the regexes/constants over from
   `styledLine`).
2. **NEW — enclosed box/table row:** trimmed line length ≥ `MIN_NO_WRAP_BORDER_LENGTH` (reuse the
   existing 20, same "below ~20 columns it fits the narrowest mirror" rationale) AND the first AND
   last non-space characters are box-drawing vertical/corner glyphs (new glyph class, below). This
   covers `│ … │` table rows, `├──┼──┤` junction rows, `┌───┐` square edges, and Grok's composer
   side rows. Horizontal-only glyphs are deliberately excluded, so the labelled input-box border
   `──── label ────` keeps its pinned non-clip behaviour.
3. **NEW — full-width highlight row:** the line is non-blank, its trailing space run is ≥ 2 spaces
   (named constant, e.g. `MIN_TRAILING_PAD = 2`), and every segment from the first non-space
   character to the end of the line carries a resolved background (`segment.bg !== undefined` —
   inverse video resolves to a bg in `lib/ansi.ts`, so `[7m` bars qualify). Leading unpainted
   indent is allowed. The coloured trailing padding is the "full-width" evidence: a highlighted
   word in prose never has coloured spaces after it.
4. **NEW — trailing padded-space strip:** if the trailing space run is ≥ 2 spaces, trim it from the
   tail segments (slice the last affected segment's text, drop segments emptied by the trim). A
   single trailing space is kept (byte-faithful for typed values, e.g. the plan-dialog input row).
   A line that is ALL spaces becomes `{ segments: [] }` — its background colour vanishes with it,
   which is exactly "coloured empty lines go away". Interior spaces are never touched, so wrap-off
   panning stays column-faithful.

New glyph class in `web/src/lib/rule-glyphs.ts`: `BOX_ENCLOSURE_GLYPH_CLASS` — vertical strokes and
corner/junction glyphs (square and rounded), explicitly excluding the horizontal-only set. Follow
that file's doctrine: it shares the alphabet, never a predicate or threshold; add its own comment
saying what question it answers (is this row an enclosed box/table row?) and what a false positive
costs (crops a prose row that happens to start and end with box glyphs — which is why horizontals
are out and the 20-cell floor stands).

### Superseded pins (call out in the CHANGELOG-adjacent comments, update the tests)

The existing `it.each` "does not mark" table in `blocks.test.ts` pins three rows whose policy this
request reverses. They flip from unmarked to `noWrap: true`, and their comments must be rewritten
to record the supersession:

- `table edge` `┌${─×40}┐` → now marked (enclosed by square corners).
- `corner row` `┌`.repeat(40) → now marked.
- `vertical row` `│`.repeat(40) → now marked.
- `short rounded box` `╭${─×19}╮` (21 cells ≥ 20) → now marked; rewrite the case as a genuinely
  short box (e.g. `╭${─×10}╮`) to keep pinning "short decorative boxes in prose still wrap".

Pins that MUST survive unchanged: `labelled border` (`── Pi ──`, horizontal ends), `prose`, `ASCII
rule`, `mixed rule row`, `mixed content` (`────x`), and the cross-module pin that a labelled
input-box border the reply guard depends on is never clipped.

## Files to touch

1. **`web/src/lib/rule-glyphs.ts`** — add `BOX_ENCLOSURE_GLYPH_CLASS` with its own doc comment
   (the file's "this is the whole shared surface" header stays true: it's an alphabet, not a
   predicate).
2. **`web/src/lib/blocks.ts`**
   - Remove classification from `styledLine` (it returns `{ segments }` only); move
     `MIN_NO_WRAP_BORDER_LENGTH`, `PURE_HORIZONTAL_BORDER`, `ROUNDED_BOX_BORDER` into the new
     presentation section.
   - Add `presentLine` / `presentLines` / `presentBlocks` per the design above.
   - Update the module-header invariant comment: `splitLines` output is byte-exact (grammars, guard,
     status strip); the PRESENTED raw-block lines — what the renderer draws AND what find's haystack
     and link offsets are built from — reproduce the visible mirror character-for-character *after*
     the trailing-pad strip. Find coherence is automatic because `ansi-output.tsx` builds the
     haystack from the same presented lines it renders.
   - Update the `StyledLine.noWrap` doc comment to list the four row classes.
3. **`web/src/components/ansi-output.tsx`** — one change:
   `const blocks = useMemo(() => presentBlocks(buildBlocks(splitLines(segments), { agent })), [segments, agent]);`
   Everything downstream (haystack, links, offsets, the `noWrap && wrap` clip branch) already
   operates on these lines. No markup changes.
4. **`web/src/lib/blocks.test.ts`**
   - Move the `splitLines — no-wrap terminal borders` describe to `presentLines` (same assertions;
   the "ANSI-segmented border" and threshold cases unchanged).
   - Update the superseded pins (above), keeping the survivors.
   - New `presentLines` cases: enclosed `│ a │ b │` row ≥ 20 cells marked; short `│ a │` unmarked;
   junction `├──┼──┤` marked; prose containing an interior `│` unmarked; ASCII `| a | b |` unmarked.
   - New highlight cases: inverse/full-bg row with ≥ 2 coloured trailing spaces marked; same row
   with no trailing padding unmarked; highlight that starts mid-line but runs to the padded end
   marked; highlighted word followed by unstyled spaces unmarked.
   - New strip cases: run ≥ 2 spaces stripped from the last segment (style kept on the surviving
   text); segments emptied by the trim dropped; single trailing space kept; all-space coloured line
   → `{ segments: [] }`; interior spacing untouched.
   - New agent-neutrality case: the same synthetic buffer (table row + highlight bar + padded row)
   run through `presentBlocks(buildBlocks(...))` for `agent: "claude"`, `"grok"`, and `undefined`
   yields identical presented raw lines — the "agy goes through the same classifier" pin.
   - Update the plan-fixture test (`keeps the plan fixture's long dashed separators as clipped raw
   rows`) to go through `presentBlocks`.
5. **`web/src/components/ansi-output.test.tsx`** — new render cases in the `mirror line wrapping`
   describe:
   - A wide `│ … │` box row renders as one `span.inline-block` clipped row with full text.
   - A full-width highlight row (`ESC[7m` + text + long space run + `ESC[27m`) renders clipped,
   keeps its `backgroundColor`, and its `textContent` has no trailing spaces.
   - A coloured padded row (`ESC[41m` + "ok" + 60 spaces + `ESC[0m`) renders as exactly "ok" in one
   bg-carrying span; a pure-space coloured line renders with no bg span at all.
   - Find still matches text on a line AFTER a stripped row (offset threading survives the strip),
   and a link after a clipped row still renders (extend the existing clipped-border test's pattern).
   - Wrap-off: existing pan assertions hold; add that an enclosed row under `wrap={false}` gets no
   `inline-block` wrapper and its interior columns are untouched.
6. **Version + changelog (mandatory, functional change):** bump `0.48.0` → `0.48.1` (PATCH — the
   wrap feature doing what it was always meant to do) in `herdr-plugin.toml`, `package.json`,
   `web/package.json`; add a `## [0.48.1] - <real date>` entry under **Fixed** (one crisp line per
   change, commit hash appended after the functional commit lands). Run `scripts/check-version.sh`
   — it must print `✓`.

## Order of work

1. `rule-glyphs.ts` class → `blocks.ts` presentation pass (move + new predicates + strip) →
   `ansi-output.tsx` one-liner.
2. Rewrite/extend `blocks.test.ts`, then `ansi-output.test.tsx`.
3. Verify (below), then version bump + CHANGELOG + `check-version.sh`.

## Verification

- `cd web && bun run test` — all frontend tests green (new + moved + updated).
- Root `bun run build` — typechecks both sides (root tsc + web tsc) and builds; must succeed.
- Root `bun run test` — backend suite untouched, must stay green (pre-push runs both anyway).
- `scripts/check-version.sh` → `✓`.
- Manual smoke (optional, deployment host): a grok pane's `│ > │` composer row and a table row stay
  one visual row with wrap on; claude prose still wraps; View → Wrap off still pans.

## Explicit non-goals / guardrails

- No change to the wrap default, the View toggle, or `preClass`.
- No changes under `bridge/`, no new dependency, no harness-adapter edits.
- Do not strip or classify inside `splitLines` — guard.ts and the grammars must keep seeing exact
  bytes.
- ASCII `|`-delimited rows stay wrapping (prose false-positive risk); only Unicode box-drawing
  enclosure clips.
- omp's `trimBorderSegments` (`harness/omp/chrome.ts`) deliberately returns lines without `noWrap`;
  after this change such shaved rows are ordinary narrow content and presentLines leaves them alone
  — confirm that when reading, don't "fix" it.
