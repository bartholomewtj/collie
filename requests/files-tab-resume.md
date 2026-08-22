Close the remaining Files-tab review findings: required tests are still incomplete. Feature behaviour from requests/files-tab.md is unchanged.

Where: `bridge/workdir.test.ts`, `web/src/components/bottom-nav.test.tsx`, `web/src/routes/files.test.tsx`

Done means:
- `bridge/workdir.test.ts` covers containment (symlink inside the root pointing outside → `?path=link` 404s and the target's bytes never appear), search (case-insensitive name match; a hit under `node_modules/` is absent; `q: "a"` returns `[]`; results cap sets `truncated`), download (`content-disposition: attachment`, `content-length`; over `DOWNLOAD_CAP_BYTES` → 413; refused/typed-escape → 404), preview caps (over `PREVIEW_CAP_BYTES` → `truncated: true` and `text.length === PREVIEW_CAP_BYTES`; a `0x00` byte → `binary: true`, no `text`), gate (`workRoot` set + cross-origin `Origin` → 403 from `guard`), typed `?path=node_modules/pkg/index.js` 404, listing also drops `config/`.
- `web/src/components/bottom-nav.test.tsx`: Files sits between Traces and Settings; click navigates to `/files`; keep Traces assertions.
- `web/src/routes/files.test.tsx` exists: directory rows, tap folder navigates; 3 characters fire exactly one `/api/files/search` after the 200 ms debounce (fake timers) and render results; `binary: true` shows download and no `<pre>`; copy writes the relative path to a stubbed `navigator.clipboard`.

Out of scope: `adws/`, new Files-tab behaviour, another version bump (already 0.53.0)
