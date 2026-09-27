#!/bin/sh
# preflight-release.sh — the gate between "git tag" and a release nobody can trust.
#
#   sh scripts/preflight-release.sh              refuse or approve a tag of the CURRENT version
#   sh scripts/preflight-release.sh --ack-docs   also pass check 7 (see below)
#
# POSIX sh on purpose, no bashisms, NO flock (flock does not exist on Windows Git
# Bash / MINGW64, and this has to run there as well as on mac and linux). every
# check below exists because it went wrong once, for real, on this repo, on the
# night v1.2.3 was tagged. that history is worth keeping attached to the code —
# a check whose reason is written down survives a refactor; a check that is just
# "seemed prudent" gets deleted by the next person in a hurry.
#
#   1. dirty tree            — a tag should describe an exact tree; an uncommitted
#                               diff is a tag that lies about what it contains.
#   2. origin/main ancestor  — v1.2.3 was tagged on 78.file-manager while origin/main
#                               was 174 commits ahead and had 2 commits the branch
#                               never got. the release was built from a branch nobody
#                               would clone. this check makes that specific shape of
#                               mistake fail loudly instead of shipping.
#   3. HEAD on/under main    — same miss from the other side: a release should come
#                               from main, or from a branch main already swallowed.
#   4. version agreement     — package.json, src-tauri/Cargo.toml, tauri.conf.json and
#                               Cargo.lock's own entry were never mechanically checked
#                               against each other before a tag. v1.2.3 happened to
#                               agree by luck of commit sequence, not because anything
#                               verified it. luck is not a release process.
#   5. version not re-tagged — v1.2.2 got tagged over an existing tag and that is the
#                               mistake this check exists solely to make impossible.
#   6. KNOWN-ISSUES current  — docs/KNOWN-ISSUES.md said "the current release is
#                               v1.2.1" two releases late. it is public, and it is
#                               linked from the bug-report form, so a stale version
#                               there sends a real user's report down the wrong path.
#   7. docs-vs-code drift    — WARNING, not a mechanical fail, on purpose: three
#                               chapters described behaviour that shipped commits had
#                               already changed, with no "Later addition:" paragraph.
#                               whether a given source diff needs one is a judgment
#                               call this script cannot make — it can only name the
#                               files and the count and make someone look. so it
#                               blocks until a human (or a session) has looked and
#                               passed --ack-docs; it does not try to guess "safe".
#   8. the full gate         — bun run check:contrast / build / test, bunx tsc
#                               --noEmit, and in src-tauri: cargo fmt --check, cargo
#                               clippy --all-targets -D warnings, cargo test. this is
#                               the expensive tier, so it is the LAST thing this
#                               script does and it does not run at all if a cheaper
#                               check above already blocks the release — no reason to
#                               spend minutes building a tag that cannot be cut anyway.
#   9. releaseBody wired     — the draft release body came out EMPTY because
#                               tauri-action's releaseBody input was unset, and
#                               tauri-action does not read the tag message on its own.
#                               that got fixed by hand once already; this check makes
#                               the fix permanent by refusing a release.yml that
#                               regresses it in any job.
#
# exit 0 only if every check above passed (7 requires --ack-docs to count as a pass).
# exit 1 and a numbered blocker list otherwise. this script never tags, never edits
# release.yml or docs/, and never runs the release workflow — it only looks.

set -u

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd) || exit 1
cd "$REPO_ROOT" || exit 1

ACK_DOCS=0
for arg in "$@"; do
  case "$arg" in
    --ack-docs) ACK_DOCS=1 ;;
    -h|--help)
      echo "usage: sh scripts/preflight-release.sh [--ack-docs]"
      exit 0
      ;;
    *) echo "preflight-release: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

BLOCK_N=0
BLOCKERS=""

# short one-line entry in the closing blocker list; the detail already printed
# above it under the check's own heading.
block() {
  BLOCK_N=$((BLOCK_N + 1))
  BLOCKERS="${BLOCKERS}  ${BLOCK_N}. $1
"
}

pass_line() { printf '  PASS  %s\n' "$1"; }
fail_line() { printf '  FAIL  %s\n' "$1"; block "$1"; }
warn_line() { printf '  WARN  %s\n' "$1"; }

echo "preflight-release: checking the tree before you tag"
echo ""

# ---------------------------------------------------------------------------
# check 1 — working tree clean. an uncommitted diff means the tag would not
# describe the tree it is stamped on.
# ---------------------------------------------------------------------------
echo "[1] working tree clean"
DIRTY=$(git status --porcelain)
if [ -z "$DIRTY" ]; then
  pass_line "no modified or untracked files"
else
  echo "$DIRTY" | sed 's/^/        /'
  fail_line "working tree is dirty — commit, stash, or clean before tagging"
fi
echo ""

# ---------------------------------------------------------------------------
# check 2 — origin/main is an ancestor of HEAD. fetch first: a stale local
# origin/main would pass this by accident, which is worse than not checking
# at all. this is the exact shape of the v1.2.3 miss: tag cut on a branch that
# main had already diverged from by 174 commits, with main holding 2 commits
# the branch never had.
# ---------------------------------------------------------------------------
echo "[2] origin/main is an ancestor of HEAD"
git fetch --all --tags --quiet 2>&1 | sed 's/^/        /'
if git merge-base --is-ancestor origin/main HEAD 2>/dev/null; then
  pass_line "origin/main is fully contained in HEAD"
else
  MISSING=$(git log --oneline origin/main ^HEAD 2>&1)
  MISSING_N=$(printf '%s\n' "$MISSING" | grep -c . 2>/dev/null || printf '0')
  echo "        main has ${MISSING_N} commit(s) HEAD lacks:"
  printf '%s\n' "$MISSING" | sed 's/^/          /'
  fail_line "origin/main is NOT an ancestor of HEAD — see the ${MISSING_N} commit(s) above"
fi
echo ""

# ---------------------------------------------------------------------------
# check 3 — HEAD is on main, or main already contains HEAD. a release should
# come from main; a branch main has already swallowed is an acceptable second
# case (e.g. a release cut right after merging, before switching branches).
# ---------------------------------------------------------------------------
echo "[3] HEAD is on main, or main already contains it"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$CURRENT_BRANCH" = "main" ]; then
  pass_line "HEAD is on main"
elif git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  if [ "$CURRENT_BRANCH" = "HEAD" ]; then
    pass_line "HEAD is detached, and main already contains it"
  else
    pass_line "HEAD is on '$CURRENT_BRANCH', which main already contains"
  fi
else
  if [ "$CURRENT_BRANCH" = "HEAD" ]; then
    fail_line "HEAD is detached and main does not contain it — release should come from main"
  else
    fail_line "HEAD is on '$CURRENT_BRANCH' and main does not contain it — release should come from main"
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# check 4 — version agreement across every manifest that names one. nobody
# checked this before v1.2.3 was tagged; it agreed only because of the order
# the edits happened to land in. plain grep/sed on purpose — no jq dependency,
# this has to run on a bare Git Bash with nothing extra installed.
# ---------------------------------------------------------------------------
echo "[4] version agreement (package.json / Cargo.toml / tauri.conf.json / Cargo.lock)"
PKG_VERSION=$(grep -m1 '"version"' package.json 2>/dev/null \
  | sed -E 's/^[[:space:]]*"version":[[:space:]]*"([^"]*)".*/\1/')
CARGO_VERSION=$(awk '
  /^\[package\]/ { f = 1; next }
  /^\[/          { f = 0 }
  f && /^version[[:space:]]*=/ {
    v = $0
    sub(/^version[[:space:]]*=[[:space:]]*"/, "", v)
    sub(/".*/, "", v)
    print v
    exit
  }
' src-tauri/Cargo.toml 2>/dev/null)
TAURI_VERSION=$(grep -m1 '"version"' src-tauri/tauri.conf.json 2>/dev/null \
  | sed -E 's/^[[:space:]]*"version":[[:space:]]*"([^"]*)".*/\1/')
LOCK_VERSION=$(awk '
  /^\[\[package\]\]/  { f = 0 }
  /^name = "devgo"$/  { f = 1; next }
  f && /^version = /  {
    v = $0
    sub(/^version = "/, "", v)
    sub(/".*/, "", v)
    print v
    exit
  }
' src-tauri/Cargo.lock 2>/dev/null)

echo "        package.json          $PKG_VERSION"
echo "        src-tauri/Cargo.toml  $CARGO_VERSION"
echo "        tauri.conf.json       $TAURI_VERSION"
echo "        Cargo.lock (devgo)    $LOCK_VERSION"

if [ -z "$PKG_VERSION" ] || [ -z "$CARGO_VERSION" ] || [ -z "$TAURI_VERSION" ] || [ -z "$LOCK_VERSION" ]; then
  fail_line "could not extract a version from one or more manifests — see blanks above"
  TARGET_VERSION="$PKG_VERSION"
elif [ "$PKG_VERSION" = "$CARGO_VERSION" ] && [ "$PKG_VERSION" = "$TAURI_VERSION" ] && [ "$PKG_VERSION" = "$LOCK_VERSION" ]; then
  pass_line "all four agree on $PKG_VERSION"
  TARGET_VERSION="$PKG_VERSION"
else
  fail_line "manifests disagree — bump them all to the same version before tagging"
  TARGET_VERSION="$PKG_VERSION"
fi
echo ""

# ---------------------------------------------------------------------------
# check 5 — the version is not already tagged. this is the exact mistake that
# burned v1.2.2 (tagged twice, the second one silently over the first).
# ---------------------------------------------------------------------------
echo "[5] v$TARGET_VERSION is not already tagged"
EXISTING_TAG=$(git tag -l "v$TARGET_VERSION")
if [ -z "$EXISTING_TAG" ]; then
  pass_line "no existing tag v$TARGET_VERSION"
else
  fail_line "tag v$TARGET_VERSION already exists — this is the v1.2.2 mistake, do not repeat it"
fi
echo ""

# ---------------------------------------------------------------------------
# check 6 — docs/KNOWN-ISSUES.md names the version about to ship as current.
# it said "the current release is v1.2.1" two releases stale, and it is public
# and linked from the bug-report form.
#
# detection choice, stated so it can be judged: the prose wraps at ~100 columns
# ("...The current\nrelease is v1.2.3."), so a line-anchored grep misses it —
# tested against this exact file, it does. the file is whitespace-normalized
# (newlines -> spaces) before matching a single regex,
#   current release is v?X.Y.Z
# case-insensitive. that is deliberately dumb: clever enough to survive the
# file's own line-wrapping, not clever enough to guess at a reworded sentence.
# a reword that drops this exact phrase is a FAIL (not found), which is the
# safe direction — an unverifiable claim about the doc is not a pass.
# ---------------------------------------------------------------------------
echo "[6] docs/KNOWN-ISSUES.md names v$TARGET_VERSION as current"
if [ ! -f docs/KNOWN-ISSUES.md ]; then
  fail_line "docs/KNOWN-ISSUES.md not found"
else
  NORMALIZED=$(tr '\n' ' ' < docs/KNOWN-ISSUES.md)
  FOUND=$(printf '%s' "$NORMALIZED" | grep -ioE 'current release is v?[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)
  if [ -z "$FOUND" ]; then
    fail_line "no 'current release is vX.Y.Z' phrase found in docs/KNOWN-ISSUES.md — cannot verify it names v$TARGET_VERSION"
  else
    FOUND_VER=$(printf '%s' "$FOUND" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
    if [ "$FOUND_VER" = "$TARGET_VERSION" ]; then
      pass_line "doc says current release is v$FOUND_VER, matches"
    else
      fail_line "doc says current release is v$FOUND_VER — that is stale, this is the v1.2.1 mistake"
    fi
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# check 7 — docs-vs-code drift, WARN not FAIL by mechanism. three chapters
# described behaviour shipped commits had changed, with no "Later addition:"
# paragraph. whether any given source diff needed one is a judgment call this
# script has no way to make, so it does not guess: it lists what changed since
# the previous tag and REQUIRES --ack-docs to turn the warning into a pass. no
# --ack-docs, any source changed -> this check blocks, same as a hard fail,
# until someone has actually looked.
# ---------------------------------------------------------------------------
echo "[7] docs-vs-code drift since the previous tag (requires --ack-docs to pass)"
PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null)
if [ -z "$PREV_TAG" ]; then
  warn_line "no previous tag found — nothing to diff, treating as no drift"
else
  CHANGED=$(git diff --name-only "$PREV_TAG"..HEAD -- src/ src-tauri/src/ 2>/dev/null)
  if [ -z "$CHANGED" ]; then
    pass_line "no source files under src/ or src-tauri/src/ changed since $PREV_TAG"
  else
    CHANGED_N=$(printf '%s\n' "$CHANGED" | grep -c .)
    echo "        $CHANGED_N source file(s) changed since $PREV_TAG:"
    printf '%s\n' "$CHANGED" | sed 's/^/          /'
    echo "        REMINDER: check docs/chapters/ and docs/KNOWN-ISSUES.md for drift against"
    echo "        these — a changed behaviour with no 'Later addition:' paragraph is exactly"
    echo "        how tonight's three chapters went stale."
    if [ "$ACK_DOCS" -eq 1 ]; then
      pass_line "$CHANGED_N file(s) changed, acknowledged via --ack-docs"
    else
      fail_line "$CHANGED_N file(s) changed since $PREV_TAG and not acknowledged — review docs/chapters/ and docs/KNOWN-ISSUES.md, then re-run with --ack-docs"
    fi
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# check 8 — the full gate. deliberately LAST and deliberately skipped if any
# check above already blocks: this is the expensive tier (a real build, a real
# cargo test/clippy pass), and there is no reason to spend the minutes on a
# release that a cheap check upstream has already refused.
# ---------------------------------------------------------------------------
echo "[8] full gate: bun run check:contrast / build / test, bunx tsc --noEmit,"
echo "    cargo fmt --check / clippy -D warnings / test"
if [ "$BLOCK_N" -gt 0 ]; then
  echo "        SKIPPED — $BLOCK_N earlier check(s) already block this release; fix"
  echo "        those first. this tier is not free, so it does not run for nothing."
else
  gate_step() {
    step_label=$1; step_dir=$2; shift 2
    printf '        %-28s ' "$step_label"
    step_out=$( { cd "$step_dir" && "$@"; } 2>&1 )
    step_rc=$?
    if [ "$step_rc" -eq 0 ]; then
      echo "green"
      step_counts=$(printf '%s\n' "$step_out" | grep -E 'Tests|Test Files|test result:' | sed 's/^/          /')
      [ -n "$step_counts" ] && printf '%s\n' "$step_counts"
    else
      echo "RED"
      echo "        --- $step_label ---"
      printf '%s\n' "$step_out" | sed 's/^/        /'
      echo "        --- end $step_label ---"
      block "$step_label failed — see output above"
    fi
  }

  if command -v bun >/dev/null 2>&1; then
    gate_step "bun run check:contrast" "$REPO_ROOT" bun run check:contrast
    gate_step "bun run build"          "$REPO_ROOT" bun run build
    gate_step "bun run test"           "$REPO_ROOT" bun run test
    gate_step "bunx tsc --noEmit"      "$REPO_ROOT" bunx tsc --noEmit
  else
    fail_line "bun not on PATH — cannot run the frontend gate"
  fi

  if command -v cargo >/dev/null 2>&1; then
    gate_step "cargo fmt --check"                          "$REPO_ROOT/src-tauri" cargo fmt --check
    gate_step "cargo clippy --all-targets -D warnings"     "$REPO_ROOT/src-tauri" cargo clippy --all-targets -- -D warnings
    gate_step "cargo test"                                 "$REPO_ROOT/src-tauri" cargo test
  else
    fail_line "cargo not on PATH — cannot run the rust gate"
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# check 9 — release.yml sets releaseBody in every tauri-action job. the draft
# release body came out EMPTY once already because this input was unset and
# tauri-action does not read the annotated tag's message on its own. plain
# grep, not a yaml parser, matching the task's own framing of this check: count
# the tauri-action steps and the releaseBody: lines and require them equal and
# non-empty (a bare "releaseBody:" with nothing after it does not count).
# ---------------------------------------------------------------------------
echo "[9] release.yml sets releaseBody in every job"
WORKFLOW=".github/workflows/release.yml"
if [ ! -f "$WORKFLOW" ]; then
  fail_line "$WORKFLOW not found"
else
  ACTION_N=$(grep -c 'tauri-apps/tauri-action' "$WORKFLOW")
  BODY_N=$(grep -cE 'releaseBody:[[:space:]]*[^[:space:]]' "$WORKFLOW")
  echo "        tauri-action jobs: $ACTION_N   releaseBody set: $BODY_N"
  if [ "$ACTION_N" -gt 0 ] && [ "$BODY_N" -eq "$ACTION_N" ]; then
    pass_line "every tauri-action job sets a non-empty releaseBody"
  else
    fail_line "releaseBody is missing (or empty) in at least one tauri-action job — this is the empty-draft mistake"
  fi
fi
echo ""

# ---------------------------------------------------------------------------
# summary
# ---------------------------------------------------------------------------
echo "============================================================"
if [ "$BLOCK_N" -eq 0 ]; then
  echo "PREFLIGHT OK — safe to tag v$TARGET_VERSION"
  exit 0
else
  echo "PREFLIGHT BLOCKED — $BLOCK_N check(s) must be fixed before tagging v$TARGET_VERSION:"
  printf '%s' "$BLOCKERS"
  exit 1
fi
