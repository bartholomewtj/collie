# Plan — SSSF traces tab: find repos below the pane cwd and attach to the newest run

Follow-up to `5f2a9c11_sssf-viz-mount.md` (shipped 0.33.0, PR #38). Status: **built — 0.34.0.**
Built as planned, with two small differences: the repo is pinned on the tab's first open (a later
snapshot re-attaching elsewhere never swaps the frame under the reader), and the run to open on is
read once at mount for the same reason.

## What's wrong

Discovery in `bridge/sssf-viz.ts` walks **up** from each pane's `cwd` to a git worktree root holding
`adws/adw_data/sssf.db`. Bart's panes all sit at `C:\claudeOS` (not a git repo); the agent runs the
ADW inside `Projects\<repo>` by path, so the pane cwd never changes and the walk finds nothing → no
Traces chip, ever. The feature as shipped only works when a pane is opened inside the repo.

Also: the chip lands on the sessions list. After kicking off a run you want the lanes of *that* run.

## Decisions already made — do not re-litigate

- **No pane-text scraping in this round.** The ADW prints `adw_id: <8 hex>`, and grepping the
  launching pane would pin the exact run and pane, but it costs a `pane.read` per poll per pane.
  Held as a refinement only if the heuristic below ever attaches to the wrong run (which needs two
  ADWs live in two repos at once — not Bart's workflow).
- **No global run registry** — claudeSSSF writes none (`~/.claudesssf` holds only `boxes.json`), and
  the visualiser stays untouched (it already forwards every host query param, so `&repo=` costs
  nothing there).
- **Candidates come from the filesystem near the panes, never from the client.** Same rule as
  before: the client sends ids (`ws`, now also `repo`); paths stay in the bridge.
- One PR, branch → merge, MINOR bump (new behaviour, nothing renamed).

## Behaviour

1. **Candidates.** For each workspace, from each distinct pane cwd: walk **up** as now, AND scan
   **down** ≤ 2 levels for git worktree roots (`.git` present) holding `adws/adw_data/sssf.db`.
   Bounded: skip names starting with `.`, `node_modules`, `dist`, `build`, `target`, `venv`,
   `__pycache__`; at most 200 directory entries per level; never follow symlinks/junctions
   (`lstat`, skip if not a real directory). Result: `Candidate { name, root, dbPath }`, `name` =
   `basename(root)` (dedupe by real path). Cached per cwd; recheck when the pane set changes and
   every 30 s, as today.
2. **Attach.** For each candidate open the db (shared per path, as today) and read the newest
   session (`sessions(1)` — already sorted newest-first by the visualiser's `db.ts`; verify, else
   sort by `started_at`). Choose the candidate whose newest session started most recently, a
   `running` one beating a finished one regardless of time. That is the workspace's **attached** repo
   and **attached run** (`adw_id` when `running`, else none).
3. **Snapshot** (`workspace.sssf`) grows from `{state, token}` to:
   ```ts
   { state: "ready" | "pending", token,
     repos: Array<{ name: string; state: "ready" | "pending"; running: boolean }>,
     attached: { repo: string; adwId?: string } | undefined }
   ```
   `state` stays as the roll-up (`ready` if any repo is ready) so `SssfChip` needs no change.
   The token is unchanged; per-repo db choice is `?repo=<name>` on the frame URL and every API call.
4. **API.** `/sssf/api/*` takes `ws` + optional `repo`; missing/unknown `repo` → the attached
   repo; a name that isn't a candidate for that workspace → 404. `repo` is only ever a Map key.
5. **Frame.** `sssfFrameSrc(ws, token, session, repo, adwId?)` → `/sssf/?ws=…&repo=…&t=…&embed=1#/`
   or `#/<adwId>` when attached to a live run. First open of the tab uses the attached repo + run.
6. **Repo picker.** When `repos.length > 1`, a one-line chip row above the frame (Collie-side,
   `sssf-frame.tsx`): one chip per repo, a small dot on the running one, attached one selected.
   Selecting a repo remounts the frame (`key`), same trick as the "back to list" re-tap. Single repo:
   no row. State is per space, resets with it, like `tab`.
7. **`pending`** keeps its meaning per repo (an `adws/` dir, no db yet); the roll-up chip is greyed
   only when *no* repo is ready.

## Files

| File | Change |
|---|---|
| `bridge/sssf-viz.ts` | `locate()` → `locateAll()` (up + bounded down); `Found` becomes `{repos: Candidate[], attached}`; `dbFor(session, ws, repo?)`; `decorate()` emits the new shape; newest-session read via `db.sessions(1)`. |
| `bridge/sssf-viz.test.ts` | down-scan finds a repo 2 levels below a non-git cwd; bounded (ignored dirs, depth 3 not found); attach prefers `running`, then newest; unknown `repo` → 404; `repo` param not path-y (only Map lookup — assert `..%2F` 404s, never touches fs). Fixture: temp tree with two fake repos, dbs copied from claudeSSSF's or created via the visualiser's own schema (check `db.ts` for a `CREATE` helper; else copy the 64 KB real db and `setArchived`-free rows). |
| `bridge/types.ts`, `web/src/lib/types.ts` | `WorkspaceView.sssf` new shape (additive fields; `state`+`token` kept). |
| `web/src/components/sssf-frame.tsx` | `sssfFrameSrc(..., repo, adwId?)`, `SssfRepoRow`, frame `key` includes repo. |
| `web/src/routes/space.tsx` | `sssfRepo` state (default = attached), pass to frame + row; ~6 lines. |
| `README.md` → SSSF traces tab | "Which repo" paragraph: up **and** ≤2 levels down from the pane's directory; newest run wins; picker when several. |
| `CHANGELOG.md`, three version files | MINOR bump. |
| `.adr/0024` | Consequences: note the down-scan is bounded and still filesystem-only; no new ADR. |

## Not doing

- Pane-text `adw_id` scraping (see decisions). Journal-transcript parsing for `cd <repo>` (same cost
  class, more fragile).
- Deep-linking a *finished* run — the list is the right landing when nothing is live.
- A `SSSF_REPOS=` env list — the scan replaces it; revisit only if scanning ever proves slow (it
  runs at most every 30 s per workspace against ≤ 200×200 dirents, cached).

## Security notes

- Down-scan reads directory names only, under the pane cwd's realpath, no symlink following, bounded
  fan-out; opens a db only at `<root>/adws/adw_data/sssf.db` of a worktree root. Same containment
  posture as ADR 0024; `repo` is a name looked up in a Map the bridge built.
- Nothing new crosses the sandbox boundary: `repo` rides in the same URL as `ws` and `t`.

## Verify

- `SSSF_VIZ_DIR=… SSSF_TEST_REPO=… bun test bridge/sssf-viz.test.ts` (integration half).
- Bridge on 8799 with `SSSF_VIZ_DIR`, then in a bun REPL/harness: `decorate([ws], [{cwd:"C:/claudeOS"}])`
  → `repos` lists collie, claudeSSSF, geneanalysis, articlegenerator (whichever have dbs); `attached`
  = the most recent run.
- Phone: open any workspace at `C:\claudeOS` → Traces chip → repo row → lanes of the latest run.

## Rough size

~80 lines bridge, ~40 lines web, tests, docs. Half a session.
