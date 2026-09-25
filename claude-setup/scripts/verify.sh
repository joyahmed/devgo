#!/bin/sh
# devgo — the verification gate.
#
# WHAT IT IS: every tier below was MEASURED GREEN on 2026-09-26 before it was
# put in here. Nothing is gated on a check that was already red — a gate that
# blocks the first push gets deleted, not obeyed. The measurements, and what
# this repo genuinely cannot verify, live in the private memory repo, under
# claude-setup/memory/devgo/verification-baseline.md (this repo is public and
# keeps no session notes of its own).
#
# USAGE
#   sh claude-setup/scripts/verify.sh              # every gating tier, ~10s warm
#   sh claude-setup/scripts/verify.sh --quick      # drops cargo test/build, ~5s
#   sh claude-setup/scripts/verify.sh --clippy     # ALSO prints clippy, informational
#
# EXIT CONTRACT — the caller (a pre-push hook, copurge, a session) relies on it:
#   0 = nothing that ran failed. Skipped tiers do NOT make it non-zero; they are
#       printed loudly instead, because a hook environment can legitimately be
#       missing a toolchain and a gate that DIES is worse than one that skips —
#       the caller cannot tell "died" from "found something".
#   1 = a gating tier genuinely failed. Only this blocks a push.
#
# ⛔ NO `set -u`. An unset HOME under `set -u` killed the sibling repo's
# verify.sh outright ("HOME: unbound variable") — the gate did not report, it
# crashed. Every expansion of an environment variable here is written
# "${VAR:-}" on purpose. Tested under `env -i PATH=/usr/bin:/bin`.
#
# ⛔ NO `set -e` either. Every tier must run so the report is complete.
#
# POSIX sh only: no [[, no arrays, no `local`, no GNU-only flags.

# ---------------------------------------------------------------- where we are
# Resolve the repo root from this script's own location (<root>/claude-setup/
# scripts/verify.sh), never from $PWD — a hook may run us from anywhere.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 0
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd) || exit 0

QUICK=0
WANT_CLIPPY=0
for arg in "$@"; do
	case "$arg" in
		--quick) QUICK=1 ;;
		--clippy) WANT_CLIPPY=1 ;;
		-h|--help) sed -n '3,30p' "$0"; exit 0 ;;
		*) printf 'verify: ignoring unknown argument %s\n' "$arg" >&2 ;;
	esac
done

FAILED=0
SKIPPED=0
RAN=0
SKIP_NOTES=""
FAIL_NOTES=""

note_skip() {
	SKIPPED=$((SKIPPED + 1))
	SKIP_NOTES="${SKIP_NOTES}
  - $1"
	printf '  SKIP  %s\n' "$1"
}

note_fail() {
	FAILED=$((FAILED + 1))
	FAIL_NOTES="${FAIL_NOTES}
  - $1"
	printf '  FAIL  %s\n' "$1"
}

note_pass() {
	RAN=$((RAN + 1))
	printf '  ok    %s\n' "$1"
}

# ------------------------------------------------------- resolving the toolchain
# ⛔ Git runs hooks with a MINIMAL environment. cargo and bun are both installed
# under $HOME on this machine and neither is on a bare PATH. Resolve them by
# hand; when resolution fails, skip loudly (never die, never guess).
#
# node is deliberately NOT resolved: nothing here needs it. bun runs both the
# contrast script and tsc. That matters, because node on the Mac exists only
# inside nvm — `env -i PATH=/usr/bin:/bin command -v node` finds nothing, so a
# tier shelling out to bare `node` would skip on EVERY push, which is
# indistinguishable from having no gate at all.

find_tool() {
	# find_tool <name> <candidate path> [<candidate path> ...]
	tool_name=$1
	shift
	if command -v "$tool_name" >/dev/null 2>&1; then
		command -v "$tool_name"
		return 0
	fi
	for cand in "$@"; do
		case "$cand" in
			/*) ;;          # absolute only — a relative candidate means an
			*) continue ;;  # empty $HOME, and "/.cargo/bin/cargo" is nobody's cargo
		esac
		if [ -x "$cand" ]; then
			printf '%s\n' "$cand"
			return 0
		fi
	done
	return 1
}

# ⛔ cargo is NOT under $HOME/.cargo/bin on every machine and it is not on this
# Mac: rustup is installed by homebrew, so cargo is the shim
# /opt/homebrew/opt/rustup/bin/cargo and $HOME/.cargo does not exist at all.
# Measured 2026-09-26. A gate that only looks in ~/.cargo/bin skips every cargo
# tier on this box while reporting a cheerful green for the rest.
# The rustup toolchain's own bin/ is the last resort, found by glob.
RUSTUP_CARGO=""
for cand in "${RUSTUP_HOME:-${HOME:-}/.rustup}"/toolchains/*/bin/cargo; do
	if [ -x "$cand" ]; then RUSTUP_CARGO="$cand"; break; fi
done

CARGO=$(find_tool cargo \
	"${CARGO_HOME:-}/bin/cargo" \
	"${HOME:-}/.cargo/bin/cargo" \
	/opt/homebrew/opt/rustup/bin/cargo \
	/usr/local/opt/rustup/bin/cargo \
	/opt/homebrew/bin/cargo \
	/usr/local/bin/cargo \
	"$RUSTUP_CARGO") || CARGO=""

BUN=$(find_tool bun \
	"${BUN_INSTALL:-}/bin/bun" \
	"${HOME:-}/.bun/bin/bun" \
	/usr/local/bin/bun \
	/opt/homebrew/bin/bun) || BUN=""

# ⛔ Resolving the BINARY is not enough. `cargo fmt` is not built in — cargo
# execs a sibling `cargo-fmt` and finds it ON PATH, not next to itself.
# Measured 2026-09-26 under `env -i HOME=$HOME PATH=/usr/bin:/bin`:
#   /opt/homebrew/opt/rustup/bin/cargo fmt --check
#     → "error: no such command: `fmt`", exit 101
# which a naive gate would report as a FORMATTING FAILURE and block the push on.
# Putting the resolved tool's own directory on PATH fixes it, and is why this
# gate reports the truth under a hook environment rather than a plausible lie.
for resolved in "$CARGO" "$BUN"; do
	[ -n "$resolved" ] || continue
	resolved_dir=$(dirname -- "$resolved")
	case ":${PATH:-}:" in
		*":$resolved_dir:"*) ;;
		*) PATH="$resolved_dir${PATH:+:}${PATH:-}" ;;
	esac
done
export PATH

BASH_BIN=$(find_tool bash /bin/bash /usr/bin/bash /usr/local/bin/bash /opt/homebrew/bin/bash) || BASH_BIN=""
JQ=$(find_tool jq /usr/bin/jq /usr/local/bin/jq /opt/homebrew/bin/jq) || JQ=""

# ⛔ cargo takes an EXCLUSIVE lock on target/. If another cargo or rustc is
# running (a dev build, `tauri dev`, rust-analyzer's check pass) cargo does not
# fail — it BLOCKS on the lock, which from a push looks exactly like a hang.
# Skip the cargo tiers loudly instead. We never touch the lock and we never
# signal another process: DevGo itself may be running.
cargo_busy() {
	ps -ax -o command= 2>/dev/null \
		| grep -E '(^|/)(cargo|rustc)([ 	]|$)' \
		| grep -v 'grep' >/dev/null 2>&1
}

printf '── devgo verify ── %s\n' "$ROOT"

# ============================================================ tier 1: server sh
# The two server scripts ship to a box and are run by hand there; a syntax
# error is found by the user, not by us. CI parses them; so do we. GREEN.
if [ -n "$BASH_BIN" ]; then
	t1=0
	for f in "$ROOT"/server/*.sh; do
		[ -f "$f" ] || continue
		"$BASH_BIN" -n "$f" 2>&1 || t1=1
	done
	if [ "$t1" -eq 0 ]; then note_pass 'server shell scripts parse (bash -n)'
	else note_fail 'server shell scripts parse (bash -n)'; fi
else
	note_skip 'server shell scripts — no bash found'
fi

# ========================================================== tier 2: server json
# The example actions file is the documented contract for a user-written file.
# Invalid JSON there is a support ticket. GREEN.
if [ -n "$JQ" ]; then
	if "$JQ" empty "$ROOT/server/devgo-actions.example.json" >/dev/null 2>&1; then
		note_pass 'server/devgo-actions.example.json is valid JSON (jq empty)'
	else
		note_fail 'server/devgo-actions.example.json is valid JSON (jq empty)'
	fi
else
	note_skip 'server JSON contract — no jq found'
fi

# ============================================================= tier 3: cargo fmt
# GREEN, 0.5s. src-tauri/rustfmt.toml is the repo's own config.
if [ -z "$CARGO" ]; then
	note_skip 'cargo fmt --check — no cargo found'
elif cargo_busy; then
	note_skip 'cargo fmt --check — another cargo/rustc holds the target/ lock'
else
	if ( cd "$ROOT/src-tauri" && "$CARGO" fmt --check ) >/dev/null 2>&1; then
		note_pass 'cargo fmt --check'
	else
		note_fail 'cargo fmt --check  (run: cd src-tauri && cargo fmt)'
	fi
fi

# =========================================== tiers 4 and 5: cargo build and test
# cargo build GREEN 3s warm. cargo test GREEN — 269 passed, 0 failed, 4s warm.
# ⚠️ The launcher tests share temp names; CI retries once with
# --test-threads=1 to tell a race from a real failure. We do the same, so a
# flaky parallel run does not block a push on a lie.
if [ "$QUICK" -eq 1 ]; then
	note_skip 'cargo build + cargo test — --quick was passed'
elif [ -z "$CARGO" ]; then
	note_skip 'cargo build + cargo test — no cargo found'
elif cargo_busy; then
	note_skip 'cargo build + cargo test — another cargo/rustc holds the target/ lock'
else
	if ( cd "$ROOT/src-tauri" && "$CARGO" build ) >/dev/null 2>&1; then
		note_pass 'cargo build'
	else
		note_fail 'cargo build'
	fi
	if ( cd "$ROOT/src-tauri" && "$CARGO" test ) >/dev/null 2>&1; then
		note_pass 'cargo test (269 expected)'
	elif ( cd "$ROOT/src-tauri" && "$CARGO" test -- --test-threads=1 ) >/dev/null 2>&1; then
		note_pass 'cargo test (passed single-threaded — the parallel run raced)'
	else
		note_fail 'cargo test'
	fi
fi

# ======================================================== tier 6: contrast rules
# `bun run check:contrast` from package.json. GREEN — 6 palettes x 8 rules,
# 5 lane hues. This is the ONLY automated check on anything visual in the repo.
if [ -z "$BUN" ]; then
	note_skip 'contrast rules — no bun found'
elif ( cd "$ROOT" && "$BUN" scripts/check-contrast.mjs ) >/dev/null 2>&1; then
	note_pass 'contrast rules (bun scripts/check-contrast.mjs)'
else
	note_fail 'contrast rules (bun scripts/check-contrast.mjs)'
fi

# ========================================================== tier 7: TS typecheck
# The real command is `tsc`, from package.json's build script — tsconfig.json
# already sets noEmit, strict, noUnusedLocals, noUnusedParameters. GREEN, 3s.
# Run through `bun x` so it does not need node on PATH (node_modules/.bin/tsc
# is `#!/usr/bin/env node` and would skip on every push under a hook env).
if [ -z "$BUN" ]; then
	note_skip 'TypeScript typecheck — no bun found'
elif ( cd "$ROOT" && "$BUN" x tsc ) >/dev/null 2>&1; then
	note_pass 'TypeScript typecheck (tsc, noEmit via tsconfig.json)'
else
	note_fail 'TypeScript typecheck (tsc) — rerun visibly: bun x tsc'
fi

# =================================================== clippy — KNOWN RED, NEVER GATES
# ⛔ DO NOT make this a gating tier and DO NOT "fix the gate" by deleting this
# note. Measured 2026-09-26, on a clean tree, at commit 3c6a6c5:
#
#   cargo clippy --all-targets -- -D warnings   →  exit 101, SIX errors
#     1. src/services/platform/runtime.rs:4   empty_line_after_outer_attr
#     2. src/commands.rs:754                  unnecessary_lazy_evaluations
#     3. src/services/platform/wsl.rs:36      chunks_exact_to_as_chunks
#     4. src/services/ssh_config.rs:27        manual_pattern_char_comparison
#     5. src/services/github.rs:902           assertions_on_constants
#     6. src/services/platform/wsl.rs:202     items_after_test_module
#
# All six are in committed code and predate this gate. CI does not run clippy
# (.github/workflows/ci.yml gates on bash -n, jq, bun run build, cargo test),
# so nothing regressed — clippy was simply never part of the contract.
#
# They are all trivially fixable. Fix them in their own commit, re-measure, and
# THEN promote this block to a gating tier. Until that happens it runs only
# under --clippy and its status is discarded, because a gate that blocks every
# push on day one gets deleted rather than obeyed.
if [ "$WANT_CLIPPY" -eq 1 ]; then
	if [ -z "$CARGO" ]; then
		printf '  info  clippy — no cargo found\n'
	elif cargo_busy; then
		printf '  info  clippy — another cargo/rustc holds the target/ lock\n'
	else
		printf '  info  clippy (informational, never gates):\n'
		( cd "$ROOT/src-tauri" && "$CARGO" clippy --all-targets -- -D warnings ) 2>&1 \
			| grep -E '^(error|warning)' | sed 's/^/        /'
		printf '  info  6 pre-existing clippy errors are expected here — see the comment in this script.\n'
	fi
fi

# ---------------------------------------------------------------------- verdict
printf '──\n'
if [ "$SKIPPED" -gt 0 ]; then
	printf '⚠️  %s tier(s) DID NOT RUN:%s\n' "$SKIPPED" "$SKIP_NOTES"
	printf '   This pass is NARROWER than it looks. Do not read it as "verified".\n'
fi
if [ "$FAILED" -gt 0 ]; then
	printf '⛔ FAILED (%s of %s that ran):%s\n' "$FAILED" "$((RAN + FAILED))" "$FAIL_NOTES"
	exit 1
fi
printf '✅ %s tier(s) passed, %s skipped.\n' "$RAN" "$SKIPPED"
# ⚠️ Green here does NOT mean the UI works. devgo has ZERO frontend tests.
if [ "$SKIPPED" -eq 0 ]; then
	printf '   Still not proof the UI works — this repo has no frontend tests at all.\n'
fi
exit 0
