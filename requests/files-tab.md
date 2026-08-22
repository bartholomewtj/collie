Add a Files tab to Collie mobile: a read-only file browser of the operator's work directory.

Tapping a file does **preview + copy path + optional download to the phone**. Folders navigate. Find is **filename search as you type**. The tree starts at `COLLIE_WORK_ROOT` (operator sets it to `C:\claudeos`); skip secrets and junk (`.env`, `node_modules`, `.git`, `config`, caches) and refuse those even if the path is typed. The Files tab shows **only if the env is set**.

Where: `bridge/` (new filesystem reader beside `bridge/sssf-viz.ts` and `bridge/journal/files.ts` `containedRealpath`), `bridge/server.ts`, `bridge/config.ts`, `web/src/components/bottom-nav.tsx`, `web/src/router.tsx`, `web/src/lib/nav.ts`, `web/src/lib/api.ts`, `web/src/routes/root.tsx`, `CONTEXT.md`, `CLAUDE.md`, `README.md`, `.env.example`, `.adr/` (third filesystem reader — same terms as ADR 0024: opt-in, containment after symlink resolution, byte/dirent caps, client never sees a host absolute path).

Done means:
- With `COLLIE_WORK_ROOT` unset, no Files tab, no `/api/files*` routes.
- With it set, bottom bar has Files; you can walk folders, search names as you type, open a file, copy its relative path, and download it to the phone.
- `.env` and the skip list never list or serve, including by typed path.
- Preview is text; download is the optional way to save a file (including non-text) to the phone.
- Read-only: no edit, rename, delete, move, upload, or send-to-pane.
- New capability: MINOR version bump per `CLAUDE.md`. Tests cover containment, skip/refuse, listing, search, and the tab-hidden-when-unset case.

Out of scope: `adws/`
