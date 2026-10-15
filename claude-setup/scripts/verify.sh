#!/bin/sh
# devgo — the door the machine-wide pre-push hook knocks on.
#
# WHY THIS FILE IS THIN: the hook in ~/.git-hooks/pre-push runs
# claude-setup/scripts/verify.sh on every repo that ships one. devgo's real gate
# moved to scripts/verify.sh, and this file stayed behind as an older, weaker
# copy: skips counted as a pass, clippy did not block, and it still said "this
# repo has no frontend tests at all". So a push from copurge ran one gate and a
# push by hand ran another. Now there is one gate, and this file only gets it
# running under a hook's environment.
#
# WHAT IT ADDS: git runs hooks with a bare PATH, and bun, cargo and node live
# under $HOME, nvm or homebrew. scripts/verify.sh does not look for them, so under
# `env -i HOME=$HOME PATH=/usr/bin:/bin` every check skipped and it exited 1 —
# the hook reads 1 as RED and would refuse every push. Measured on the Mac,
# 2026-10-15. This file finds the tools, puts their directories on PATH, and
# hands over.
#
# EXIT CONTRACT (the hook relies on it):
#   0  scripts/verify.sh ran and everything was green  -> push
#   1  scripts/verify.sh says red, or skipped something -> push refused
#   3  bun, cargo or node cannot be found on this box at all  -> the hook lets the
#      push through and says nothing was verified. A gate that blocks for a
#      reason that is not its own gets deleted.
#
# usage: sh claude-setup/scripts/verify.sh [any scripts/verify.sh argument]

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 3
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd) || exit 3

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

# cargo is not under ~/.cargo/bin on the Mac: rustup comes from homebrew, so
# cargo is /opt/homebrew/opt/rustup/bin/cargo. The toolchain's own bin/ is the
# last resort, found by glob.
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

# node is needed too, and its absence lies rather than skips: `bun run test`
# with no node on PATH runs vitest on bun itself, the jsdom workers fail to
# start ("addEventListener called on an object that is not a valid instance of
# EventTarget"), and vitest reports RED on a tree that is green under node.
# Measured on the Mac, 2026-10-15. On the Mac node lives in nvm, so try nvm's
# default alias, then the newest nvm install, then the system ones.
NVM_DIR_=${NVM_DIR:-${HOME:-}/.nvm}
NVM_DEFAULT_NODE=""
if [ -f "$NVM_DIR_/alias/default" ]; then
	nvm_ver=$(tr -d ' \n' < "$NVM_DIR_/alias/default")
	case "$nvm_ver" in v*) ;; *) nvm_ver="v$nvm_ver" ;; esac
	NVM_DEFAULT_NODE="$NVM_DIR_/versions/node/$nvm_ver/bin/node"
fi
NVM_NEWEST_NODE=""
if [ -d "$NVM_DIR_/versions/node" ]; then
	nvm_newest=$(ls "$NVM_DIR_/versions/node" 2>/dev/null | sort -t. -k1.2,1n -k2,2n -k3,3n | tail -1)
	[ -n "$nvm_newest" ] && NVM_NEWEST_NODE="$NVM_DIR_/versions/node/$nvm_newest/bin/node"
fi

NODE=$(find_tool node \
	"$NVM_DEFAULT_NODE" \
	"$NVM_NEWEST_NODE" \
	/usr/local/bin/node \
	/opt/homebrew/bin/node) || NODE=""

if [ -z "$CARGO" ] || [ -z "$BUN" ] || [ -z "$NODE" ]; then
	missing=""
	[ -n "$CARGO" ] || missing="cargo"
	[ -n "$BUN" ] || missing="${missing:+$missing, }bun"
	[ -n "$NODE" ] || missing="${missing:+$missing, }node"
	printf 'verify: cannot run here — %s not found. nothing was verified.\n' "$missing" >&2
	exit 3
fi

# resolving the binary is not enough: `cargo fmt` execs a sibling cargo-fmt it
# finds ON PATH, so a bare-PATH run fails with "no such command: fmt" and looks
# like a formatting failure. Put each tool's own directory on PATH.
for resolved in "$CARGO" "$BUN" "$NODE"; do
	resolved_dir=$(dirname -- "$resolved")
	case ":${PATH:-}:" in
		*":$resolved_dir:"*) ;;
		*) PATH="$resolved_dir${PATH:+:}${PATH:-}" ;;
	esac
done
export PATH

exec sh "$ROOT/scripts/verify.sh" "$@"
