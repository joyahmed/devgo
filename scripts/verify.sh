#!/bin/sh
# devgo verification gate, tiered so the common case stays cheap.
#
#   sh scripts/verify.sh          tiers 1+2  (typecheck, fmt, clippy)   ~10s warm
#   sh scripts/verify.sh --full   + tier 3   (bun run build, cargo test) ~10s more
#
# the numbers and the tier split come from docs/ai-memory/verification-baseline.md.
# exit 0 = everything that ran was green. exit 1 = something was red, or nothing ran.
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
}

# ⚠️ trap #1 — test for the PROCESS, never for src-tauri/target/debug/.cargo-lock.
# cargo holds an exclusive lock on src-tauri/target, so a live `tauri dev` makes
# clippy/test BLOCK instead of fail, which reads as a hang. but the .cargo-lock
# FILE exists while cargo is idle too, so keying off it would skip the rust tier
# on every single run and the gate would quietly stop checking rust forever.
rust_is_busy() {
  if command -v tasklist >/dev/null 2>&1; then
    # the // is git-bash's escape: msys rewrites it to a single / for tasklist.
    if tasklist //FI "IMAGENAME eq cargo.exe" //NH 2>/dev/null | grep -qi 'cargo\.exe'; then
      return 0
    fi
    if tasklist //FI "IMAGENAME eq rustc.exe" //NH 2>/dev/null | grep -qi 'rustc\.exe'; then
      return 0
    fi
    return 1
  fi
  if command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command \
      "if (Get-Process cargo,rustc -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" \
      >/dev/null 2>&1 && return 0
    return 1
  fi
  # no way to look: assume clear rather than skipping rust forever (see trap #1).
  return 1
}

if [ "$FULL" -eq 1 ]; then
  echo "verify: tiers 1+2+3 (full — the pre-main set)"
else
  echo "verify: tiers 1+2 (default — pass --full for the pre-main set)"
fi

# ⚠️ trap #2 — a missing tool SKIPS, it does not fail. a gate that hard-errors
# because someone's shell lost bun on PATH gets deleted by the first person who
# hits it. the safety net is the EXECUTED counter at the bottom: skipping
# everything is the one case that must still be loud and red.
echo "frontend:"
if command -v bun >/dev/null 2>&1; then
  run_check "tsc --noEmit" "$REPO_ROOT" bunx tsc --noEmit
  if [ "$FULL" -eq 1 ]; then
    # dist/ is gitignored and no dev server reads it (vite serves :1420 from
    # memory), so this build cannot disturb anything and needs no scratch dir.
    run_check "bun run build" "$REPO_ROOT" bun run build
  fi
else
  skip "tsc --noEmit" "bun not on PATH"
  [ "$FULL" -eq 1 ] && skip "bun run build" "bun not on PATH"
fi

echo "rust:"
if ! command -v cargo >/dev/null 2>&1; then
  skip "cargo fmt --check" "cargo not on PATH"
  skip "cargo clippy -D warnings" "cargo not on PATH"
  [ "$FULL" -eq 1 ] && skip "cargo test" "cargo not on PATH"
elif rust_is_busy; then
  echo "  !! RUST TIER SKIPPED — a cargo/rustc process is live (tauri dev?)."
  echo "  !! cargo would BLOCK on the src-tauri/target lock, not fail. stop the"
  echo "  !! dev server and re-run if you need rust verified."
  skip "cargo fmt --check" "cargo/rustc running"
  skip "cargo clippy -D warnings" "cargo/rustc running"
  [ "$FULL" -eq 1 ] && skip "cargo test" "cargo/rustc running"
else
  run_check "cargo fmt --check" "$REPO_ROOT/src-tauri" cargo fmt --check
  # strict form on purpose: plain `cargo clippy` exits 0 even with findings, so
  # without -D warnings this line would be decorative. baseline says zero findings.
  run_check "cargo clippy -D warnings" "$REPO_ROOT/src-tauri" cargo clippy --all-targets -- -D warnings
  if [ "$FULL" -eq 1 ]; then
    run_check "cargo test" "$REPO_ROOT/src-tauri" cargo test
  fi
fi

echo ""
echo "summary:"
printf '%s' "$SUMMARY"

# name what this repo has no way to check, so a green gate is not read as
# broader assurance than it is. list is from docs/ai-memory/verification-baseline.md.
echo ""
echo "cannot verify:"
echo "  - no JS/TS test runner at all (no vitest/jest/node:test, zero *.test.*):"
echo "    every line of React/TS is verified only by tsc types and by bundling."
echo "  - no E2E (no playwright config, no e2e/ or tests/ directory)."
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
  echo "verify: FAIL — $RED check(s) red."
  exit 1
fi
echo "verify: OK — $EXECUTED check(s) green."
exit 0
