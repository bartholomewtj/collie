# Clean Word Wrapping and Box/Highlight Clipping

## What changed

Collie's mobile terminal mirror previously wrapped all text rows by default unless they were long horizontal rules or rounded composer boxes. Table rows (such as `│ col 1 │ col 2 │`), square box borders (`┌───┐`), junction lines (`├───┤`), and full-width highlighted/coloured status bars wrapped into jagged, multi-line visual noise on narrow phone viewports. In addition, terminal rows with coloured backgrounds and long trailing space padding wrapped those empty spaces onto separate visual lines.

This change introduces a presentation pass in the core AST layer (`web/src/lib/blocks.ts`) that runs between block building and rendering:

1. **Table and Enclosed Box Row Detection:** Lines with length $\ge 20$ display cells that start and end with vertical or corner box-drawing glyphs (`BOX_ENCLOSURE_GLYPH_CLASS` in `rule-glyphs.ts`) are marked `noWrap: true`. When wrapping is on, they are rendered as a clipped, single-row element (`inline-block max-w-full overflow-hidden`).
2. **Full-Width Highlight Row Detection:** Lines where all content from the first non-space character through the end has a background color and ends with trailing whitespace padding ($\ge 2$ spaces) are marked `noWrap: true`.
3. **Trailing Space Padding Stripping:** Runs of $\ge 2$ trailing spaces are stripped from the tail segments of lines. Entirely empty coloured lines collapse to zero segments (eliminating phantom blank coloured bars), while single trailing spaces (e.g. for input carets) and interior spaces (for column alignment) remain byte-faithful.
4. **Byte-Fidelity Preservation for Guard and Grammars:** `splitLines` remains completely byte-exact; the presentation transformations (`presentLine`, `presentLines`, `presentBlocks`) run downstream purely for rendering and find indexing in `ansi-output.tsx`.
5. **Universal Agent Coverage:** The presentation pass lives in the core blocks pipeline, applying uniformly to Claude, Grok, OMP, and unadapted agents like agy.

## Changed files

- `herdr-plugin.toml`: Bumped version to `0.48.1`.
- `package.json`: Bumped version to `0.48.1`.
- `web/package.json`: Bumped version to `0.48.1`.
- `CHANGELOG.md`: Added release entry for `[0.48.1]`.
- `web/src/lib/rule-glyphs.ts`: Added `BOX_ENCLOSURE_GLYPH_CLASS` containing vertical strokes, corners, and junction glyphs.
- `web/src/lib/blocks.ts`: Added `presentLine`, `presentLines`, `presentBlocks`, `isFullWidthHighlight`, and `stripTrailingSpaces`; moved border regexes to the presentation pass; documented presentation/invariant guarantees.
- `web/src/components/ansi-output.tsx`: Wrapped `buildBlocks` output with `presentBlocks` in `useMemo`.
- `web/src/lib/blocks.test.ts`: Added test suites for `presentLines`, enclosed table rows, highlight rows, trailing space stripping, and agent neutrality.
- `web/src/components/ansi-output.test.tsx`: Added DOM-level rendering tests for table clipping, highlight clipping, coloured space stripping, and find match offset threading.
- `specs/6eefb81b_smart-wrap.md`: Task specification and plan.

## How to verify

1. Run the frontend unit tests:
   ```bash
   cd web && bun run test
   ```
2. Run root typechecks and build:
   ```bash
   bun run build
   ```
3. Run version check:
   ```bash
   scripts/check-version.sh
   ```
4. Behavior verification:
   - On a mobile pane, prose continues to wrap smoothly.
   - Long tables (`│ ... │`) and box rows remain on a single line, clipped cleanly at the right viewport edge.
   - Coloured background bars do not generate trailing blank coloured wrap rows.
   - Toggling **View -> Wrap** off continues to allow horizontal panning with full column fidelity.
