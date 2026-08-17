# Plan — Issue #6: `update` checks out unverified origin HEAD and execs it

## Note on the request file

`requests/issue-6-verified-update.md` did not exist when this plan was written. The source of truth
used here is GitHub issue #6 (`gh issue view 6`), title *"Medium: update checks out unverified origin
HEAD and execs it"*, label `security`. Step 0 writes the missing request file so the record matches
`requests/issue-1-loopback-origin.md` and `requests/issue-5-env-parse-not-source.md`.

Line numbers in the issue body have drifted. Every line number below was re-read from the current
tree and is correct as of `4144429`.

## The problem

`scripts/collie-ctl.sh:670-679`, the managed-checkout half of `update_checkout()`:

```bash
echo "updating Collie (Herdr-managed checkout: fetch + detach onto origin HEAD)…"
if [ "$(git -C "$PLUGIN_ROOT" rev-parse --is-shallow-repository)" = true ]; then
  git -C "$PLUGIN_ROOT" fetch --depth 1 origin HEAD
else
  git -C "$PLUGIN_ROOT" fetch origin HEAD
fi
git -C "$PLUGIN_ROOT" checkout -q --detach --force FETCH_HEAD
```

then `cmd_update()` at 686-689:

```bash
cmd_update() {
  update_checkout
  exec bash "${PLUGIN_ROOT}/scripts/collie-ctl.sh" _apply-update
}
```

Three faults, in descending order of how much they matter:

1. **`update` takes whatever is on the default branch right now, not a release.** There is no tag, no
   pin, no version comparison — `origin HEAD` is the tip of `main`, including a commit pushed thirty
   seconds ago and never released. The script then **`exec`s the freshly-fetched copy of itself**
   (line 688) and that copy runs `bun install` in both trees (243, 244) and `bun run typecheck` (248,
   249). Anyone who can push to upstream `main` — or anyone who can briefly impersonate it — gets
   code execution as the operator, on a host whose whole purpose is driving real terminals.

2. **It contradicts the thing that told the operator to update.** `bridge/update.ts` decides
   "a release is available" from `vX.Y.Z` **tags** — `SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/` at line
   24, `latestReleaseTag` at 53-62, fetched from the GitHub API at 122-136. The banner
   (`web/src/components/update-banner.tsx:41`) says *"Collie 0.30.0 available"* and links to that
   release's page. The operator invokes `update` and gets **main's tip**, which may be several
   unreleased commits past `v0.30.0` — or, mid-release, a half-bumped tree. The advertised artefact
   and the delivered artefact are simply not the same object.

3. **`bun install` is unpinned on the update path.** Lines 243-244 are bare `"$BUN" install`, with no
   `--frozen-lockfile`. CI already uses it on both trees (`.github/workflows/ci.yml:26,33`), so the
   deployment path is the *looser* of the two. A lockfile the fetched commit didn't intend can be
   resolved and executed via postinstall.

The `contrib/windows/collie-ctl.ps1` mirror has the identical shape at 423-446 (`Update-CollieCheckout`)
and 470-475 (`Update-Collie`).

## What we're building

**Pin the managed-checkout update to the newest `vX.Y.Z` release tag, and freeze the lockfiles.**

After this change, `update` on a Herdr-managed install fetches and checks out exactly the tag the
banner advertised, and refuses rather than guessing when it cannot find one.

**We are deliberately NOT implementing the issue's fix 2 (`git verify-tag`).** See *Why signature
verification is deferred* below — it is not a scoping dodge, it is that the verification would have
nothing to verify and would brick `update` for every user on the first run. That reasoning goes into
an ADR rather than being lost here.

### Verified mechanics

Every git command below was run against scratch repos before this plan was written. The results are
facts, not expectations:

| Check | Result |
| --- | --- |
| `git ls-remote --tags --refs --sort=-v:refname origin 'v*'` | newest-first, works against a **plain-path** remote (which is how `collie-ctl.test.sh` stages origins) and against the real `upstream` |
| …with **zero** matching tags | prints nothing and **exits 0** — an empty result must be tested for explicitly, it will not fail on its own |
| `git fetch --depth 1 origin tag vX.Y.Z` on a shallow detached checkout | succeeds; `rev-parse --is-shallow-repository` stays `true` |
| `git checkout -q --detach --force refs/tags/vX.Y.Z` | lands on the tag's tree, **not** the untagged tip; `git describe --tags --exact-match` then prints the tag |
| running both again, already on the tag | clean no-op, exit 0 |
| the same tag checkout in a **linked clone** | **detaches the developer's branch** — see the shape asymmetry below |
| `bun install --frozen-lockfile --dry-run`, root and `web/` | both exit 0 on the current tree, so freezing breaks nothing today |
| upstream `v0.29.0` | annotated tag object, **unsigned** (`git tag -v` → `error: no signature found`) |

### The shape asymmetry, and why it is correct

`update_checkout` already routes on one predicate, `is_managed_checkout()` (line 646-648), and
ADR 0006 requires that it stay one predicate. **Tag-pinning applies to the managed (detached) branch
only.** The linked-clone branch keeps `git pull --ff-only`.

That is not an oversight:

- Checking out a tag in a linked clone **detaches it from its branch** (verified above). A linked
  clone is a developer's own working tree; silently knocking it off `main` is destructive and would
  strand any local work behind a detached HEAD.
- A managed checkout is *already* detached and is replaced wholesale on every update — Herdr's own
  refresh semantics, per ADR 0006's `--force` clause. Nothing is lost by pinning it.
- The trust models genuinely differ: a linked clone tracks a remote the developer chose and can
  inspect with `git log` before pulling; a managed checkout is a headless auto-update on a host the
  operator may never log into.

Document the asymmetry rather than hiding it.

## Files to touch

| File | Change |
| --- | --- |
| `requests/issue-6-verified-update.md` | **new** — the missing request record (step 0) |
| `scripts/collie-ctl.sh` | `newest_release_tag()`, the pinned managed branch of `update_checkout` (653-680), `--frozen-lockfile` (243-244) |
| `scripts/collie-ctl.test.sh` | a `tag_origin` helper, **fix the two existing update tests**, add six new ones, register all of them |
| `contrib/windows/collie-ctl.ps1` | mirror the same change in `Update-CollieCheckout` (423-446) and the build install |
| `contrib/windows/collie-ctl.test.ps1` | fix the managed-checkout case (207-227) the same way |
| `.adr/0011-update-pins-to-the-newest-release-tag.md` | **new** — the decision + the deferred-signing reasoning |
| `.adr/0006-…md` | one pointer line marking its "default-branch tip" clause refined by 0011 |
| `.adr/README.md` | add the 0011 row to the index table (L63-75) |
| `README.md` | L405, L433, L458-467, L487-498 |
| `CLAUDE.md` | the "two checkout shapes" bullet under *Build / run* |

Do **not** touch `herdr-plugin.toml`, `package.json`, `web/package.json` or `CHANGELOG.md` — see
*Versioning* at the bottom. Do **not** touch `bridge/update.ts` — see *Out of scope*.

## Step 0 — write the missing request file

`requests/issue-6-verified-update.md`, same one-paragraph-per-line shape as
`requests/issue-5-env-parse-not-source.md`: what to fix, where (file + line numbers), what done
means, what is out of scope. State plainly that signature verification is deferred to ADR 0011 and
that `bridge/update.ts` is unchanged.

## Step 1 — `newest_release_tag()` (`scripts/collie-ctl.sh`, new, just above `update_checkout`)

Place it after `is_managed_checkout` (648) so the two selectors read together.

```bash
# The newest vX.Y.Z tag on the remote, or empty. Printed WITHOUT the leading refs/tags/.
newest_release_tag() { … }
```

Requirements, each of which came out of a real failure mode:

- **Discovery is `git ls-remote`, not `git fetch --tags`.** `ls-remote` reads refs without
  downloading objects, so a shallow managed checkout stays cheap and stays shallow. Verified against
  both a plain-path remote and the real `upstream`.
- **Match the bridge's grammar exactly.** `bridge/update.ts:24` accepts only `^v(\d+)\.(\d+)\.(\d+)$`
  — no prereleases, no suffixes. The `ls-remote` glob `'v*'` is looser than that (it matches
  `v0.31.0-rc.1`, `vNext`), so **filter the result** with
  `grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$'`. If the script and the banner disagree about what counts as
  a release, we have re-created fault 2 in a new place.
- **`--refs`** to drop the `^{}` peeled duplicates that annotated tags produce. All Collie tags are
  annotated, so without it every tag appears twice.
- **Sort newest-first with `--sort=-v:refname`**, which needs git ≥ 2.18 (2018). The script already
  requires `rev-parse --is-shallow-repository` (2.15), so this is a small bump — but do not assume
  it silently. If `--sort` is rejected, fall back to a portable numeric sort, which is verified to
  give the same answer:

  ```bash
  sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1
  ```

  Do **not** use `sort -V` (GNU-only; missing on older macOS) and do **not** use a plain lexical
  `sort -r`, which picks `v1.2.3` over `v0.100.1` and would happily downgrade a host.
- **`ls-remote` exits 0 with no output when nothing matches.** This is the trap. Return empty and let
  the caller decide; never let an empty tag string reach a `git checkout`.
- A **network or auth failure must be distinguishable from "no tags"** — a failed `ls-remote` exits
  non-zero. Propagate that as a failure, never as "no release found", or a transient DNS blip becomes
  a silent refusal the operator will misdiagnose.

## Step 2 — the pinned managed branch (`update_checkout`, 653-680)

Leave 654-663 exactly as they are: the `rev-parse --git-dir` guard and the linked-clone
`git pull --ff-only` path are unchanged.

Replace the managed half (670-679) with:

1. Resolve the target ref:
   - if `COLLIE_UPDATE_REF` is set and non-empty, use it verbatim (see below);
   - else `newest_release_tag`.
2. If the target is empty → **refuse**. Print what happened, why, and the escape hatch, then
   `return 1`. **Do not fall back to `origin HEAD`** — a fallback that reactivates on the exact input
   an attacker controls (delete or hide the tags) is not a safety net, it is the vulnerability with
   extra steps.
3. Fetch just that tag, keeping the existing shallow conditional from 671-675:
   - shallow → `git fetch --depth 1 origin tag "$TAG"`
   - full → `git fetch origin tag "$TAG"`
4. `git checkout -q --detach --force "refs/tags/${TAG}"` — keep `-q` (the "leaving N commits behind"
   noise, comment at 676-677) and keep `--force` (ADR 0006's lockfile clause).
5. **Assert where we landed** before returning: `git describe --tags --exact-match` must print the
   tag we intended. Cheap, and it turns a subtle wrong-tree bug into a loud failure.
6. Update the progress line at 670 and the `→ now at …` line at 679 to name the tag, so the operator
   can eyeball that it matches the banner.

`COLLIE_UPDATE_REF` is the single escape hatch, and it covers three real cases with one variable:
a fork with no releases, a deliberate rollback to an older tag, and pinning during an incident. Take
it verbatim without the semver filter — the operator naming a specific ref has already made the
decision. Document it in the README's update section.

**Note for the ADR:** freezing the lockfiles (step 3) means `bun install` can no longer rewrite the
tracked `bun.lock`, which is the exact scenario ADR 0006 cites to justify `--force`. Keep `--force`
anyway — other things dirty a tree — but the justification is now weaker than 0006 states, and 0011
should say so rather than leaving a stale rationale in place.

## Step 3 — `--frozen-lockfile` (`scripts/collie-ctl.sh:243-244`)

```bash
( cd "${PLUGIN_ROOT}" && "$BUN" install --frozen-lockfile )
( cd "${PLUGIN_ROOT}/web" && "$BUN" install --frozen-lockfile )
```

Both verified to pass on the current tree. Add a comment saying why: the lockfile ships in the same
commit as the `package.json`, so on the update path they always agree; a resolution that *doesn't*
match the lockfile means the tree is not what the release intended, and that should stop the build,
not be silently reconciled.

**Do not add a new `SKIP_*` hatch for this.** A developer who has just edited `package.json` runs
bare `bun install` themselves — that is the hatch, it already exists, and it regenerates the lockfile
they are then expected to commit. Adding `SKIP_FROZEN_LOCKFILE=1` would give the deployment path a
documented way back to the unsafe behaviour.

This does change one visible behaviour: `collie-ctl.sh build` in a dev tree with an out-of-date
lockfile now fails where it used to quietly fix itself. That is the intended trade and belongs in the
CHANGELOG line.

## Step 4 — the Windows mirror

`contrib/windows/collie-ctl.ps1` carries the same bug at 423-446 and the same unpinned installs.
Port the change mechanically — it is a close structural mirror, so keep the function names and the
operator-visible strings aligned with bash:

- a `Get-CollieNewestReleaseTag` helper alongside `Test-CollieManagedCheckout` (419-421);
- the same refuse-on-empty behaviour, raised as a `throw` (matching the file's convention at 425,
  not bash's `return 1`);
- `& git -C $script:PluginRoot fetch @depth origin tag $tag` then
  `checkout -q --detach --force "refs/tags/$tag"`, each followed by `Assert-LastExit` (125-127) —
  native exit codes are not caught by `$ErrorActionPreference` there;
- `--frozen-lockfile` on the bun installs;
- honour `$env:COLLIE_UPDATE_REF`.

Keep it PowerShell 5.1-compatible: no ternary, no `??`, no `?.` (the file targets `powershell.exe`
explicitly at 221 and 472).

The Windows tree is explicitly unsupported and not in CI (`contrib/windows/README.md`), but the issue
names those lines and leaving a known-vulnerable copy of a security fix in the repo is worse than the
small cost of mirroring it.

## Tests

### The two existing tests that this change BREAKS

This is the most important thing for the builder to notice, because both currently pass and will
start failing for a *correct* reason:

1. **`scripts/collie-ctl.test.sh:878-904`, `test_update_advances_a_herdr_managed_checkout`.**
   `advance_origin` (853-859) makes an **untagged** second commit, and the test asserts `VERSION` is
   `v2` afterwards. Under tag-pinning there is no release tag to move to, so update will now (rightly)
   refuse. Fix by tagging: the test must assert that update lands on the newest **tagged** release.
2. **`contrib/windows/collie-ctl.test.ps1:207-227`** — same assertion, same fix.

Do not "fix" these by loosening the new behaviour.

### Harness changes needed first

- Add a `tag_origin <tag>` helper next to `stage_origin` (843-851) and `advance_origin` (853-859),
  using the existing `git_q` wrapper (839-841) so the fixture commits keep their pinned identity:
  `git_q -C "$ORIGIN_DIR" tag -a "$1" -m "$1"`. Annotated, to match real Collie tags — a lightweight
  tag would not exercise the `--refs` de-duplication.
- `run_update_checkout` (861-876) writes a **fixed** set of exports into its generated harness. Give
  it an optional second argument for extra environment (e.g. `COLLIE_UPDATE_REF=v0.29.0`) so the
  override can be tested without a second near-duplicate harness.
- `git` is **not** stubbed anywhere in this suite — the update tests drive the real binary against
  real scratch repos. All the mechanics above were verified in exactly that configuration, including
  against a plain-path (non-`file://`) remote, which is what `stage_origin` creates.

### New tests (`scripts/collie-ctl.test.sh`)

Follow the house style exactly: a `test_*` function opening with a prose comment explaining *why the
behaviour matters*, `setup_case <short-name>` first, then `assert_eq` / `assert_contains` / `fail`.

1. **`test_update_pins_a_managed_checkout_to_the_newest_release_tag`** — the headline security test.
   Stage origin, tag `v0.29.0`, advance + tag `v0.30.0`, then advance once more **without a tag**.
   Assert the managed checkout lands on the `v0.30.0` tree and **not** the untagged tip, that
   `describe --tags --exact-match` is `v0.30.0`, that it is still shallow and still detached, and
   that the output names the tag.
2. **`test_update_ignores_prereleases_and_non_semver_tags`** — with `v0.30.0`, `v0.31.0-rc.1`,
   `nightly` and `latest` all present, assert it picks `v0.30.0`. This is the test that keeps the
   script's grammar tied to `bridge/update.ts:24`.
3. **`test_update_picks_the_highest_version_not_the_highest_string`** — tags `v0.9.0` and `v0.100.1`;
   assert `v0.100.1`. Guards the sort against a lexical regression that would silently downgrade.
4. **`test_update_refuses_when_no_release_tag_exists`** — origin with commits but no `v*` tag. Assert
   non-zero exit, that the message names `COLLIE_UPDATE_REF`, and — critically — that **HEAD did not
   move**. A refusal that already mutated the checkout is not a refusal.
5. **`test_update_honours_an_explicit_ref_override`** — `COLLIE_UPDATE_REF=v0.29.0` with `v0.30.0`
   also present; assert it lands on `v0.29.0` (the rollback case).
6. **`test_update_is_idempotent_on_the_newest_tag`** — run twice; second run exits 0 and stays put.
   Verified to be a clean no-op.
7. **`test_linked_clone_still_fast_forwards_on_its_branch`** — extend the existing
   `test_update_fast_forwards_a_linked_clone` (906-922) so the origin now *has* tags, and assert the
   clone still ends on branch `main` (`symbolic-ref --short HEAD`) and was **not** detached. This is
   the regression guard for the shape asymmetry.
8. **`test_build_installs_with_a_frozen_lockfile`** — `install_fake_bun` (737-749) already records
   argv into a calls file. Assert `--frozen-lockfile` appears on the install lines for **both** trees.
   Run the build path with `SKIP_VERSION_CHECK=1` and `SKIP_TYPECHECK=1` in the environment: the
   sandbox `PLUGIN_ROOT` has no `herdr-plugin.toml`, so the version gate at 236 would otherwise abort
   the case for an unrelated reason. Keep the existing `cut -d'|'` field order in the calls file
   intact — append, never reorder (the `test_bun_resolution` assertions depend on it).

**Register every new function in the list at `scripts/collie-ctl.test.sh:1213-1236`**, in the update
group (1227-1230). There is no auto-discovery — an unregistered test never runs and the suite still
prints `passed`.

Mirror tests 1 and 4 into `contrib/windows/collie-ctl.test.ps1` in its linear `try { … } finally { … }`
style, alongside the existing update block at 193-249.

## Step 5 — ADR 0011 and the pointer in 0006

Write `.adr/0011-update-pins-to-the-newest-release-tag.md`, Nygard format (Context / Decision /
Consequences), per `.adr/README.md`. This clears the ADR bar on both counts: someone *will* re-propose
`git verify-tag`, and the reasoning has nowhere better to live.

**Context** — the banner reads tags while `update` read branch HEAD, so the advertised artefact and
the delivered artefact were different objects; `exec` of the fetched script makes that a code-exec
path.

**Decision** — the managed checkout pins to the newest `vX.Y.Z` tag, matching
`bridge/update.ts`'s grammar; it refuses rather than falling back to HEAD; `COLLIE_UPDATE_REF`
overrides; linked clones keep `pull --ff-only` because a tag checkout would detach a developer's
branch; lockfiles are frozen.

**Consequences — and this is the part worth writing carefully:**

- **Why signature verification is deferred.** Not "too much effort" — it is currently
  unimplementable and would be actively harmful:
  - upstream's tags are annotated but **unsigned** (`git tag -v v0.29.0` → `error: no signature
    found`), verified directly;
  - there is **no key material anywhere in the repo** — no `.asc`, no `allowed_signers`, no keyring,
    no `commit.gpgsign` config, and neither workflow imports a key or produces provenance;
  - `.github/workflows/release.yml` never inspects the tag object, so nothing in CI would start
    signing on its own;
  - therefore a mandatory `git verify-tag` fails **100% of the time** and bricks `update` on first
    run — the exact class of outage ADR 0006 exists to prevent;
  - and Collie is being changed here from a **fork**; we cannot make the upstream maintainer sign,
    and a key *we* generate and commit verifies only that we signed it, which is security theatre.
  - What would justify revisiting: upstream starts pushing signed tags, **or** CI gains
    `actions/attest-build-provenance` / `cosign`. At that point the hook is one `git verify-tag`
    inside `newest_release_tag`'s caller, opt-in first, then default-on once a signed release exists
    on every supported upgrade path.
- Pinning to tags means **`update` no longer delivers unreleased `main`**. A maintainer testing a
  main-tip build now uses a linked clone or `COLLIE_UPDATE_REF`. Say so — it is a real workflow change.
- **A repo with no `v*` tags cannot self-update** without `COLLIE_UPDATE_REF`. Accepted: the banner
  never advertises an update in that state either, so the two surfaces stay consistent.
- **ADR 0006's `--force` justification is now weaker.** With `--frozen-lockfile`, `bun install` can no
  longer rewrite the tracked lockfile, which is the scenario 0006 cites. `--force` is kept as defence
  in depth; record that the original reason has largely lapsed so nobody re-derives it as load-bearing.

Then, in `.adr/0006-update-advances-the-checkout-herdr-installed.md`, add **one line** to the
Decision clause at L27-29 noting that "the default-branch tip" is refined to "the newest release tag"
by ADR 0011. Per `.adr/README.md` L58-59, **do not edit 0006's reasoning into agreement with the
present** — 0006 is not superseded, its other three clauses (one predicate, conditional `--depth 1`,
never re-link) all still stand untouched.

Add the 0011 row to the index table in `.adr/README.md` (L63-75).

## Step 6 — docs

- **`README.md:487-498`**, *"What `update` actually does to the checkout"* — the managed bullet
  currently says "fetches the default-branch tip and re-detaches onto it". Rewrite for the tag pin,
  state the refusal behaviour, mention `COLLIE_UPDATE_REF`, and explain in one sentence why linked
  clones differ. Link ADR 0011 next to the existing ADR 0006 link.
- **`README.md:458-467`**, *"Update to a new release"* — one sentence that `update` now installs the
  release the banner named, not the branch tip.
- **`README.md:405`** (Commands table) and **`README.md:433`** (Herdr actions table) — both describe
  the effect as "advance the checkout"; make it "advance to the newest release".
- **`CLAUDE.md`**, the *Build / run* bullet beginning "**There are two checkout shapes…**" — add that
  the managed shape pins to the newest `v*` tag and the linked shape fast-forwards its branch. Keep it
  short and normative and let ADR 0011 carry the argument, per the repo's own rule.

Leave the `#### If that fails with "You are not currently on a branch"` block (469-485) alone — it
documents a pre-0.23.1 recovery path this change does not affect.

## Verify

```bash
bash -n scripts/collie-ctl.sh            # parse check
bash scripts/collie-ctl.test.sh          # must print "collie-ctl lifecycle tests: passed"
bash scripts/check-version.sh            # must print ✓ (versions unchanged)
bun test ./bridge ./scripts              # unchanged; confirm no new failures
```

Judge every command by **exit status**, not by scanning output for words — `error` inside passing
output is text. Note the suite aborts on the *first* failure and still needs a real bash plus POSIX
tools, so run it under Git Bash or WSL. Per `CLAUDE.md`, a number of bridge tests fail on Windows for
POSIX path reasons; those are pre-existing — judge the bridge suite only by whether that count moves.

Manual smoke against a scratch repo (this is the shape used to verify the plan, and it is worth
re-running):

```bash
# origin with two releases and an untagged tip; managed checkout must land on v0.30.0, not the tip
scripts/collie-ctl.sh update      # prints the tag it pinned to
git -C "$PLUGIN_ROOT" describe --tags --exact-match     # v0.30.0
git -C "$PLUGIN_ROOT" rev-parse --is-shallow-repository # still true
```

Windows, manual only (not in CI):

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File contrib\windows\collie-ctl.test.ps1
```

## Out of scope

- **`bridge/update.ts` is unchanged.** It already reads tags correctly; this change makes the shell
  agree with *it*, not the other way round.
- **The `COLLIE_UPDATE_REPO` / `origin` split.** The bridge checks the GitHub API for
  `AltanS/collie` by default while `collie-ctl.sh` fetches from whatever `origin` is — on a fork
  those differ. Correct as-is (code must come from the remote it was installed from), but worth one
  sentence in the request file so the next reader doesn't file it as a bug.
- Signature/provenance verification — deferred, with the reasoning recorded in ADR 0011.
- The other audit issues (#1-#4, #7-#12).
- Changing how Herdr installs or refreshes plugins, and anything requiring a Herdr release.
- Making `update` restart-safe across a failed build, or adding rollback-to-previous-tag.

## Versioning — bump nothing

`origin` is `bartholomewtj/collie`, `upstream` is `AltanS/collie`, so this is a **fork PR**. Per
`CLAUDE.md` → *Versioning*, leave `herdr-plugin.toml`, `package.json`, `web/package.json` and
`CHANGELOG.md` **exactly as they are** — all four agree on `0.29.0` and `scripts/check-version.sh`
stays green. The commits already on this branch did the same.

The pre-commit hook will object because `scripts/` changed. Commit with
`SKIP_VERSION_CHECK=1 git commit …`, the documented escape hatch for exactly this case.

Put the proposed CHANGELOG line in the PR description instead, in the repo's house style (bolded lede,
em-dash elaboration, issue + short hash at the end):

> **Fixed:** `update` installs the release the banner advertised — the Herdr-managed checkout now
> pins to the newest `vX.Y.Z` tag instead of the default branch tip, refuses rather than falling back
> to HEAD when no release tag is found (`COLLIE_UPDATE_REF` overrides), and both `bun install` calls
> use `--frozen-lockfile` (#6)

## Branch and PR

`fix/6-verified-update` already exists and is checked out. Commit the functional change, push, and
open the PR with `gh pr create`, referencing `Fixes #6`. Because this is a security fix that changes
operator-visible update behaviour, call out in the PR body: the tag pin, the refusal (and its
override), and that signature verification is deliberately deferred with ADR 0011 explaining why —
so a reviewer doesn't read the omission as an oversight.
