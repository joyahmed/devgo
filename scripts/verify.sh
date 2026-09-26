#!/bin/sh
# devgo verification gate, tiered so the common case stays cheap.
#
#   sh scripts/verify.sh          tiers 1+2  (typecheck, vitest, fmt, clippy) ~13s warm
#   sh scripts/verify.sh --full   + tier 3   (bun run build, cargo test)      ~10s more
#
# the timings and the tier split were MEASURED against this tree, not guessed — and a
# measurement goes stale the moment the toolchain moves, so re-time rather than trust.
# exit 0 = every check ran and every check was green. exit 1 = something was red,
# or something was SKIPPED, or nothing ran — a partial run is not a pass.
# copurge reads that exit code, so keep it honest.

set -u

# run from the repo root no matter where the caller stood, because every command
# below is written relative to it.
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd) || exit 1
cd "$REPO_ROOT" || exit 1

FULL=0
for arg in "$@"; do
  case "$arg" in
    # --main is the same thing said in copurge's vocabulary: tier 3 is the
    # "before a main push" tier, nothing else distinguishes it.
    --full|--main) FULL=1 ;;
    -h|--help)
      echo "usage: sh scripts/verify.sh [--full|--main]"
      exit 0
      ;;
    *) echo "verify: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

RED=0        # checks that failed
EXECUTED=0   # checks that actually ran — if this stays 0 the gate verified nothing
SKIPPED=0    # checks that did NOT run — any of these means this was not a full run
SUMMARY=""

note() { SUMMARY="${SUMMARY}  $1
"; }

# one line per check; the tool's real output only surfaces when it fails, so a
# green run stays readable and a red run still tells you what broke.
run_check() {
  label=$1; dir=$2; shift 2
  printf '  %-24s ' "$label"
  out=$(cd "$dir" && "$@" 2>&1)
  rc=$?
  EXECUTED=$((EXECUTED + 1))
  if [ "$rc" -eq 0 ]; then
    echo "green"
    note "$(printf '%-24s green' "$label")"
  else
    echo "RED"
    echo "--- $label ---"
    echo "$out"
    echo "--- end $label ---"
    RED=$((RED + 1))
    note "$(printf '%-24s red' "$label")"
  fi
  # deliberately no early return: the report is only useful if every check ran.
}

skip() {
  printf '  %-24s skipped (%s)\n' "$1" "$2"
  note "$(printf '%-24s skipped (%s)' "$1" "$2")"
  SKIPPED=$((SKIPPED + 1))
}

# ⚠️ trap #1 — test for the PROCESS, never for src-tauri/target/debug/.cargo-lock.
# cargo holds an exclusive lock on src-tauri/target, so a live `tauri dev` makes
# clippy/test BLOCK instead of fail, which reads as a hang. but the .cargo-lock
# FILE exists while cargo is idle too, so keying off it would skip the rust tier
# on every single run and the gate would quietly stop checking rust forever.
#
# ⚠️ trap #1b — and the process test must be scoped to THIS repo. "is any cargo.exe
# alive" had the exact failure trap #1 was written to avoid: on 2026-09-26 a
# `cargo build` in G:\01_tauri\trove — a different project — made this gate report
# fmt/clippy/test "skipped" and still exit OK on the two frontend checks, and a
# commit was pushed on the back of it. another repo's build cannot touch our target
# lock, so it must not silence our rust tier.
#
# the msys path needs to be a windows path before it can be compared to what
# Win32_Process reports. cygpath -m gives G:/01_tauri/devgo (forward slashes).
repo_root_win() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$REPO_ROOT" 2>/dev/null && return 0
  fi
  # /g/01_tauri/devgo → g:/01_tauri/devgo, the one rewrite msys makes on its own.
  printf '%s\n' "$REPO_ROOT" | sed -E 's#^/([a-zA-Z])/#\1:/#'
}

# prints exactly one of:
#   ours    a cargo/rustc/test binary that belongs to THIS repo is live → it holds
#           (or is about to take) our target lock, so the rust tier must skip.
#   other   rust work is live but nothing ties it to this repo → run anyway.
#   clear   no rust work at all.
#
# the discriminator is the path, not the process name: Win32_Process gives us
# ExecutablePath and CommandLine, and anything working on us names us — rustc
# carries --out-dir <root>/src-tauri/target/..., a running `tauri dev` app and
# every test harness binary LIVE in <root>/src-tauri/target/. trove's
# `cargo.exe build --bins --release` names no path of ours and so is not ours.
#
# ⭐ unattributable cargo (bare `cargo build`, a command line we cannot read, a
# process that exits mid-query) counts as "other", i.e. we RUN. skipping on
# unknown is how the bug got here — "unknown" is the common case, so unknown→skip
# is the old behaviour under a new name. running risks a block on the target lock,
# and a block is loud: it never prints OK and never lets a commit through, where a
# silent skip did exactly that. fail toward the noisy failure.
#
# ⭐ rust-analyzer never causes a skip. the editor itself holds no build lock, and
# the transient cargo check/rustc it spawns hold ours for seconds — long enough to
# make cargo wait and print "Blocking waiting for file lock", not long enough to
# hang, and frequent enough that skipping on them would make the rust tier drop out
# at random. so anything descended from rust-analyzer is demoted to "other".
rust_activity() {
  ps_exe=""
  if command -v pwsh >/dev/null 2>&1; then
    ps_exe=pwsh
  elif command -v powershell >/dev/null 2>&1; then
    ps_exe=powershell
  fi
  if [ -n "$ps_exe" ]; then
    verdict=$(VERIFY_REPO_ROOT="$(repo_root_win)" "$ps_exe" -NoProfile -Command '
$ErrorActionPreference = "SilentlyContinue"
$root = ($env:VERIFY_REPO_ROOT).ToLower().Replace("\","/").TrimEnd("/")
$rust = "^(cargo|cargo-clippy|rustc|rustdoc|rustup)\.exe$"
$map = @{}
foreach ($p in Get-CimInstance Win32_Process) { $map[[int]$p.ProcessId] = $p }
$ours = 0; $other = 0
foreach ($p in $map.Values) {
  $isRust = $p.Name.ToLower() -match $rust
  $exe = ""; if ($p.ExecutablePath) { $exe = $p.ExecutablePath.ToLower().Replace("\","/") }
  $cl  = ""; if ($p.CommandLine)    { $cl  = $p.CommandLine.ToLower().Replace("\","/") }
  $mine = $exe.StartsWith($root + "/src-tauri/target/") -or ($isRust -and $cl.Contains($root + "/"))
  if (-not ($isRust -or $mine)) { continue }
  $cur = $p; $hops = 0; $editor = $false
  while ($cur -and $hops -lt 12) {
    if ($cur.Name -match "^rust-analyzer" -or ($cur.CommandLine -and $cur.CommandLine -match "rust-analyzer")) { $editor = $true; break }
    $cur = $map[[int]$cur.ParentProcessId]; $hops++
  }
  if ($editor) { continue }
  if ($mine) { $ours++ } else { $other++ }
}
if ($ours -gt 0) { "ours" } elseif ($other -gt 0) { "other" } else { "clear" }
' 2>/dev/null | tr -d '\r\n ')
    case "$verdict" in
      ours|other|clear) printf '%s' "$verdict"; return 0 ;;
    esac
  fi
  # not windows (or the query itself failed): ps sees the same paths.
  #
  # ⚠️ trap #1c — SNAPSHOT ps into a variable FIRST, then search the snapshot.
  # the obvious one-liner
  #     ps -eo args= | grep -F "$REPO_ROOT/src-tauri/target"
  # is a self-match: the shell starts both halves of the pipe at once, so ps lists
  # the very grep whose own argv is the pattern, and the test is true on a machine
  # with no cargo anywhere. measured on a mac at 1be0e0a with `pgrep -fl 'cargo|rustc'`
  # empty: fmt/clippy/test all "skipped" and verify exited 1, which copurge reads as
  # a refusal. that is trap #1 arriving by another road — "the gate would quietly
  # stop checking rust forever" — and it hit every mac and linux box, invisibly,
  # because windows takes the powershell branch above. the snapshot is taken before
  # any grep of ours exists, so nothing of ours can be in it; it needs no pid
  # arithmetic and no $$ juggling, and `ps -eo args=` stays byte-identical, which
  # is what keeps bsd (macos) and gnu (linux) both working.
  if command -v ps >/dev/null 2>&1; then
    procs=$(ps -eo args= 2>/dev/null)
    if [ -n "$procs" ]; then
      if printf '%s\n' "$procs" | grep -F "$REPO_ROOT/src-tauri/target" | grep -qv 'rust-analyzer'; then
        printf 'ours'; return 0
      fi
      # trap #1b on this branch too: rust work that names no path of ours is not
      # ours, so we RUN — but say so, exactly as the windows branch does. the
      # rust-analyzer filter comes first for the same reason as above: the editor
      # holds no build lock and would otherwise print that note on every run.
      if printf '%s\n' "$procs" | grep -v 'rust-analyzer' \
         | grep -Eq '(^|/)(cargo|cargo-clippy|rustc|rustdoc)([[:space:]]|$)'; then
        printf 'other'; return 0
      fi
    fi
  fi
  # no way to look. per trap #1 an unreadable answer must not become a skip.
  printf 'clear'
}

if [ "$FULL" -eq 1 ]; then
  echo "verify: tiers 1+2+3 (full — the pre-main set)"
else
  echo "verify: tiers 1+2 (default — pass --full for the pre-main set)"
fi

# is vitest actually installed in THIS tree? a LOCAL-TREE test on purpose, never
# `command -v vitest` and never `bunx vitest`: vitest is a dev dep and never lands
# on PATH, and bunx would answer a missing one by DOWNLOADING it — a gate that
# installs its own checker is worse than one that skips. that reasoning is intact;
# only the spelling below changed.
#
# ⚠️ trap #1, third instance — the old form was `[ -x node_modules/.bin/vitest ]`
# and there is NO extensionless `vitest` file in that directory on windows: bun
# writes `vitest.exe` and `vitest.bunx`. it read true here ONLY because msys `stat`
# silently retries a missing path with `.exe`. measured 2026-09-26 on this tree:
# msys sh says TRUE, node's accessSync says ENOENT, powershell's Test-Path says
# FALSE. under any sh without that retry the probe reads FALSE on a perfectly
# healthy tree and the suite SKIPS FOREVER — trap #1's own words ("the gate would
# quietly stop checking rust forever") aimed at the frontend instead.
#
# ⭐ the package manifest is the primary probe because it is what "installed"
# actually means, and `node_modules/vitest/package.json` is one spelling on all
# three platforms — no extension to guess, no shell retry in the answer. the .bin
# sweep after it is the fallback for a hoisted/linked layout, and it names every
# real spelling: extensionless symlink on mac and linux, .exe/.cmd/.ps1/.bunx on
# windows. neither branch can fetch anything.
vitest_installed() {
  [ -f "$REPO_ROOT/node_modules/vitest/package.json" ] && return 0
  for _v in vitest vitest.exe vitest.cmd vitest.ps1 vitest.bunx; do
    [ -f "$REPO_ROOT/node_modules/.bin/$_v" ] && return 0
  done
  return 1
}

# ⚠️ trap #2 — a missing tool SKIPS, it does not fail. a gate that hard-errors
# because someone's shell lost bun on PATH gets deleted by the first person who
# hits it. the safety net is the EXECUTED counter at the bottom: skipping
# everything is the one case that must still be loud and red.
echo "frontend:"
if command -v bun >/dev/null 2>&1; then
  # ⭐ `bun x`, not `bunx`: the probe one line up tests `bun`, so every command
  # under it must BE bun. `bunx` is a second binary — today the same install
  # ships both, so the old `bunx tsc` passed for a reason unrelated to what the
  # probe established, and the day they diverge (a partial install, a PATH that
  # carries one shim and not the other) the gate would hard-error where trap #2
  # says it must skip. the two checks below already go through `bun run`; this
  # line now matches them, and the probe licenses all three for real.
  run_check "tsc --noEmit" "$REPO_ROOT" bun x tsc --noEmit
  # tier 1, not tier 3: the whole suite is ~2.5s cold, which is inside the
  # noise of the tsc line above it, and a test you only run before a main
  # push is a test that tells you about a break one commit too late.
  #
  # see vitest_installed() above for why this is a local-tree file test and not
  # `command -v` — and for the msys `.exe` retry that made the old spelling lie.
  # a tree with no node_modules skips here the same way a shell with no bun does.
  if vitest_installed; then
    run_check "vitest run" "$REPO_ROOT" bun run test
  else
    skip "vitest run" "vitest not installed in node_modules — run bun install"
  fi
  if [ "$FULL" -eq 1 ]; then
    # dist/ is gitignored and no dev server reads it (vite serves :1420 from
    # memory), so this build cannot disturb anything and needs no scratch dir.
    run_check "bun run build" "$REPO_ROOT" bun run build
  fi
else
  skip "tsc --noEmit" "bun not on PATH"
  skip "vitest run" "bun not on PATH"
  [ "$FULL" -eq 1 ] && skip "bun run build" "bun not on PATH"
fi

echo "rust:"
RUST_STATE=clear
command -v cargo >/dev/null 2>&1 && RUST_STATE=$(rust_activity)
if ! command -v cargo >/dev/null 2>&1; then
  skip "cargo fmt --check" "cargo not on PATH"
  skip "cargo clippy -D warnings" "cargo not on PATH"
  [ "$FULL" -eq 1 ] && skip "cargo test" "cargo not on PATH"
elif [ "$RUST_STATE" = "ours" ]; then
  # ⚠️ open question, measured on windows 2026-09-26 and NOT changed here: this
  # skip is over-conservative even when the detection is right. with `tauri dev`
  # live, cargo fmt/clippy/test invoked by hand all completed in seconds — cargo
  # waited ~19s on the target lock once and then proceeded. "try, and report if it
  # actually blocks" would be the honest behaviour; "skip pre-emptively" trades a
  # real verification for a fear. left alone on purpose — the bug this commit fixes
  # was the detection, and redesigning the guard in the same breath would make the
  # fix unreviewable. own slice.
  echo "  !! RUST TIER SKIPPED — a cargo/rustc/target binary of THIS repo is live"
  echo "  !! (tauri dev?). cargo would BLOCK on the src-tauri/target lock, not fail."
  echo "  !! stop the dev server and re-run if you need rust verified."
  skip "cargo fmt --check" "this repo's cargo running"
  skip "cargo clippy -D warnings" "this repo's cargo running"
  [ "$FULL" -eq 1 ] && skip "cargo test" "this repo's cargo running"
else
  if [ "$RUST_STATE" = "other" ]; then
    echo "  !! rust work is live elsewhere on this machine — nothing ties it to this"
    echo "  !! repo, so the rust tier RUNS (see trap #1b). if it turns out to be ours"
    echo "  !! after all, cargo blocks on the target lock instead of lying to you."
  fi
  # ⭐ probe what each check actually RUNS, not the binary that fronts it. the
  # three lines below need three different things: `cargo fmt` needs the rustfmt
  # COMPONENT, `cargo clippy` needs the clippy component, and only `cargo test`
  # is satisfied by cargo alone. rustup installs them separately —
  # `rustup toolchain install --profile minimal` gives you cargo with NEITHER —
  # so `command -v cargo` licenses one of these three and guesses at the other
  # two. on a minimal box the guess is wrong and the gate prints
  # `error: no such command: 'fmt'` and scores RED, which says "the code is
  # broken" when the truth is "this machine cannot check formatting". that is
  # trap #2 exactly. a missing component SKIPS.
  #
  # `cargo fmt --version` / `cargo clippy --version` are the cheapest question
  # that asks the real thing: they shell out to the component itself and exit
  # 101 with "no such command" when it is absent. neither touches the target
  # lock, so neither can turn a busy tree into a red one — and both sit inside
  # this else-branch, after the `ours` skip above, so a busy repo still reports
  # the busy reason and never a component one.
  #
  # ⭐ the skip reason names the FIX, not the symptom: the reader should be able
  # to paste `rustup component add rustfmt` and move on.
  if (cd "$REPO_ROOT/src-tauri" && cargo fmt --version) >/dev/null 2>&1; then
    run_check "cargo fmt --check" "$REPO_ROOT/src-tauri" cargo fmt --check
  else
    skip "cargo fmt --check" "rustfmt component absent — rustup component add rustfmt"
  fi
  # strict form on purpose: plain `cargo clippy` exits 0 even with findings, so
  # without -D warnings this line would be decorative. baseline says zero findings.
  # and say which clippy said so. rust-toolchain.toml at the repo root pins this to
  # the version CI runs, so the line should read 0.1.98 — if it does not, your rustup
  # is missing the pinned toolchain and the skew this gate had in 09/2026 is back.
  # the version line moved INSIDE the probe: with clippy absent it used to print
  # the "no such command" error under a "clippy version" label, which reads as a
  # broken toolchain rather than an uninstalled component.
  if (cd "$REPO_ROOT/src-tauri" && cargo clippy --version) >/dev/null 2>&1; then
    printf '  %-24s %s\n' "clippy version" "$(cd "$REPO_ROOT/src-tauri" && cargo clippy --version 2>&1)"
    run_check "cargo clippy -D warnings" "$REPO_ROOT/src-tauri" cargo clippy --all-targets -- -D warnings
  else
    skip "cargo clippy -D warnings" "clippy component absent — rustup component add clippy"
  fi
  if [ "$FULL" -eq 1 ]; then
    # no component probe: `cargo test` is the one line here that cargo alone
    # satisfies, so `command -v cargo` above really does license it.
    run_check "cargo test" "$REPO_ROOT/src-tauri" cargo test
  fi
fi

echo ""
echo "summary:"
printf '%s' "$SUMMARY"

# name what this repo has no way to check, so a green gate is not read as
# broader assurance than it is. every line below was checked against the tree, not guessed.
echo ""
echo "cannot verify:"
# ⭐ COUNTED, not typed. this line carried "THREE of 37 components, 29 cases",
# then "30 cases", and was stale twice in one day — a number that lies here is
# worse than no number, because this block is the honesty the green verdict rests
# on. the case count is gone for good: `it(` greps disagree with what vitest
# actually runs (it.each, describe.each), and vitest prints the true figure two
# lines up anyway. the file counts below are exact by construction.
tested=$(ls "$REPO_ROOT"/src/components/*.test.tsx 2>/dev/null \
         | sed 's#.*/##; s#\.test\.tsx$##' | tr '\n' ',' | sed 's/,$//; s/,/, /g')
n_tested=$(ls "$REPO_ROOT"/src/components/*.test.tsx 2>/dev/null | wc -l | tr -d ' ')
n_comp=$(ls "$REPO_ROOT"/src/components/*.tsx 2>/dev/null | grep -vc '\.test\.tsx$')
echo "  - the JS/TS suite is vitest + jsdom over $n_tested of $n_comp components."
echo "    tested: ${tested:-none}"
echo "    every other line of React/TS is still verified only by tsc types and by"
echo "    bundling, and nothing here touches App's own state."
echo "  - no E2E (no playwright config, no e2e/ or tests/ directory). jsdom lays"
echo "    nothing out and paints nothing, so no test above can see a width, an"
echo "    overlap or a colour — the container-query chip gates are unwatched."
echo "  - no frontend linter (no eslint/biome/oxlint/prettier config, no lint script)."
echo "  - nothing about the launch lanes: the v1.2.1 PATH bug was invisible to"
echo "    cargo test on every platform. a green suite is not evidence for a"
echo "    launch lane — only an installed build, clicked, is."

echo ""
if [ "$EXECUTED" -eq 0 ]; then
  # skipping is fine per check; skipping ALL of them is a gate that verified
  # nothing, which is worse than no gate because it looks like a pass.
  echo "verify: FAIL — nothing was verified (every check was skipped)."
  exit 1
fi
if [ "$RED" -gt 0 ]; then
  echo "verify: FAIL — $RED check(s) red, $SKIPPED skipped, $EXECUTED ran."
  exit 1
fi
if [ "$SKIPPED" -gt 0 ]; then
  # ⭐ nothing red is not the same as everything checked. the 2026-09-26 push went
  # out on "OK — 2 check(s) green" while fmt, clippy and test had all been skipped:
  # a partial run read as a full one. a skipped check is an unverified check, so
  # the verdict is not OK and the exit code is not 0 — copurge must stop here too.
  echo "verify: INCOMPLETE — $EXECUTED check(s) green, $SKIPPED skipped, 0 red."
  echo "  nothing failed, but this was not a full run. fix the skips above (see the"
  echo "  reason on each line) and re-run before treating this tree as verified."
  exit 1
fi
echo "verify: OK — $EXECUTED check(s) green, 0 skipped."
exit 0
