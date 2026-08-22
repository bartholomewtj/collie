Close the reviewer's remaining finding on 0.56.11 (`adws/adw_data/sessions/ae5e8ece/context_handoff/review.md`, "not met" item 1): in the default uploader in `web/src/hooks/use-drop-upload.ts`, when the upload result is `!ok`, call `setStatus(result.error ?? "Image upload failed.", "error")` and then return `null`, so a failed drop is never silent; add a test in `web/src/hooks/use-drop-upload.test.tsx` that a failed upload shows that status and no "Type path" chip appears.

Where: `web/src/hooks/use-drop-upload.ts`, `web/src/hooks/use-drop-upload.test.tsx`; `herdr-plugin.toml`, `package.json`, `web/package.json`, `CHANGELOG.md`.

Done means: the new test passes; `cd web && bun run test` passes with no other test file edited; root `bun run test` still 859; `bun run typecheck` clean; PATCH bump to **0.56.12** in `herdr-plugin.toml`, `package.json`, `web/package.json` with one `CHANGELOG.md` `### Fixed` line under `## [0.56.12]`: "Desktop mode: a failed drag-and-drop upload shows an error status".

Out of scope: `web/src/hooks/use-display-prefs.ts`; `bridge/`; `web/src/components/composer.tsx`; `web/src/components/agent-chat.tsx`.
