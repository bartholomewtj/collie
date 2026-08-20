Spaces pane chrome: traces icons off the tree, filter behind a header icon.

## What

- Space and tab rows no longer show a traces/lanes icon. Traces stay on the pane header and the traces route.
- The full "Filter spaces…" box is gone from the list. Filter is a search icon in the Spaces header, next to New space. Tap to type; tap again (or the X) to close and clear.
- Filter icon only shows when there is more than one space.

Spec: `specs/32708014_spaces-filter-icon.md`

## Tests

`space-tree.test.tsx` covers: no traces buttons, filter hidden until the header icon, type-to-filter, toggle clears. Pre-push: 2618 web tests passed, typecheck clean.

Version not bumped — same as the last UI pass; cut it on the release commit.
