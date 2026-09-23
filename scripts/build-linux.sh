#!/usr/bin/env bash
# build-linux.sh - the release .deb, from a machine that has never built it.
#
# WHY THIS EXISTS: `bun install && bun tauri build` is the whole story on
# windows and the mac, and on linux it is not. tauri links against webkit2gtk
# and gtk, and a box without their -dev packages fails deep in a cargo build
# with a pkg-config error that names a .pc file and not a package. the list
# below is what an ubuntu 24.04 box actually needed on 2026-09-23, worked out
# the slow way; it is here so nobody works it out twice.
#
#   scripts/build-linux.sh              check the prerequisites, then build
#   scripts/build-linux.sh --deps       apt-install what is missing first (sudo)
#   scripts/build-linux.sh --install     dpkg -i the .deb when the build lands (sudo)
#   scripts/build-linux.sh --bundles appimage   default is deb
#
# ⚠️ --deps and --install run apt/dpkg under sudo and change the machine.
# without them this script only reads and builds.
set -euo pipefail

cd "$(dirname "$0")/.."

DEPS=0 INSTALL=0 BUNDLES=deb
while [ $# -gt 0 ]; do
	case "$1" in
		--deps)     DEPS=1; shift ;;
		--install)  INSTALL=1; shift ;;
		--bundles)  BUNDLES="${2:?--bundles needs a value}"; shift 2 ;;
		--bundles=*) BUNDLES="${1#*=}"; shift ;;
		-h|--help)  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

# the -dev packages tauri's linux target links against. libssl-dev and
# build-essential are usually already there; pkg-config is listed because a
# half-removed one (dpkg "deinstall ok config-files") reads as present to
# `command -v` and still cannot answer a --modversion.
APT_PACKAGES="libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libgtk-3-dev \
libxdo-dev libayatana-appindicator3-dev librsvg2-dev pkg-config build-essential libssl-dev"

missing=""
for p in $APT_PACKAGES; do
	dpkg -s "$p" 2>/dev/null | grep -q '^Status: install ok installed' || missing="$missing $p"
done

if [ -n "$missing" ]; then
	if [ "$DEPS" = "1" ]; then
		echo "installing:$missing"
		sudo apt-get update -qq
		# shellcheck disable=SC2086
		sudo apt-get install -y --no-install-recommends $missing
	else
		echo "missing system packages:$missing" >&2
		echo >&2
		echo "  sudo apt install -y --no-install-recommends$missing" >&2
		echo >&2
		echo "or re-run this script with --deps. nothing has been built." >&2
		exit 1
	fi
fi

# rust: the crate needs stable. rustup puts cargo in ~/.cargo/bin, which a
# non-login shell (and CI) does not have on PATH until the env file is sourced.
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
command -v cargo >/dev/null || {
	echo "cargo not found. install rust stable:" >&2
	echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal" >&2
	exit 1
}
command -v bun >/dev/null || {
	echo "bun not found: https://bun.sh" >&2
	exit 1
}

echo "rust   $(rustc --version)"
echo "bun    $(bun --version)"
echo "webkit $(pkg-config --modversion webkit2gtk-4.1)"

bun install
bun tauri build --bundles "$BUNDLES"

# tauri prints the path already, but a caller that wants to install or upload
# needs it in a variable rather than in the scrollback
deb=$(find src-tauri/target/release/bundle -name '*.deb' -newermt '-10 minutes' | head -n1)

if [ "$INSTALL" = "1" ]; then
	[ -n "$deb" ] || { echo "no .deb was produced, so there is nothing to install" >&2; exit 1; }
	sudo dpkg -i "$deb"
	echo "installed: $(dpkg -s dev-go | sed -n 's/^Version: /dev-go /p')"
	echo "run it with: DevGo"
fi
