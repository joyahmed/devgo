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
#
# ⚠️ trap #3 — the redirect has to wrap the GROUP, not the tool. the old line was
#     out=$(cd "$dir" && "$@" 2>&1)
# and `2>&1` there binds to `"$@"` alone, so `cd` keeps the script's own stderr.
# measured 2026-09-26 by driving run_check with a $dir that does not exist: the
# cd error printed to the TERMINAL in the middle of the `  %-24s ` column that the
# printf above had just opened —
#     tsc --noEmit             /path/verify.sh: line 33: cd: /no/such/dir: No such file...
#     RED
# — and $out came back EMPTY, so the block under it was
#     --- tsc --noEmit ---
#
#     --- end tsc --noEmit ---
# a red with no cause inside it. that is the worst red this script can print: the
# body of that block is the entire reason the block exists, and the one piece of
# evidence was on the terminal two lines up, wearing the column it had just broken.
# `{ ...; } 2>&1` puts the cd's stderr where every other word of this check goes.
#
# ⭐ and a bad $dir is NOT counted in EXECUTED, which is why the cd is probed on its
# own line first. EXECUTED answers exactly one question — "did this gate verify
# anything?" — and the bottom of the file leans on it to keep an all-skipped run
# loud. a check whose directory could not be entered ran no tool, compiled nothing
# and proved nothing; counting it as executed is the same lie as a silent skip, only
# in the other direction, and it would let `EXECUTED=6` vouch for a run in which
# nothing at all happened. so it scores RED (a missing src-tauri/ IS a broken tree,
# not an absent optional tool, so it is not a trap #2 skip either) and leaves
# EXECUTED alone. the probe is a second `cd` rather than a sentinel exit code
# because no exit status is safely ours to reserve — `git bisect` means 125,
# 126/127 are the shell's — and cd is a builtin, so the extra call costs nothing.
# it runs inside $( ) so it cannot move the caller's cwd, and if the directory
# disappears between the probe and the real run the group redirect above catches
# that cd too: the error lands in the block, just labelled as a tool failure.
run_check() {
  label=$1; dir=$2; shift 2
  printf '  %-24s ' "$label"
  if ! cd_err=$(cd "$dir" 2>&1); then
    echo "RED"
    echo "--- $label ---"
    printf '%s\n' "${cd_err:-cd: $dir: cannot enter (no message from cd)}"
    echo "(nothing ran: the directory is the failure, not the tool. not counted in EXECUTED.)"
    echo "--- end $label ---"
    RED=$((RED + 1))
    note "$(printf '%-24s red (bad dir — did not run)' "$label")"
  else
    out=$( { cd "$dir" && "$@"; } 2>&1 )
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
# ⛔ trap #1d — THE ps SNAPSHOT CONTAINS OUR OWN ANCESTORS, AND AN AGENT'S SHELL
# CARRIES THE WHOLE COMMAND TEXT IN ITS argv. this is the reason the function below
# filters by pid, and it is not hypothetical: measured 2026-09-27 on this tree with
# nothing rust-shaped running anywhere. `sh scripts/verify.sh` run from a claude code
# Bash call has an ancestor `/usr/bin/bash -c ...<the entire command>...`, so a call
# as ordinary as
#     ls -d /abs/path/devgo/src-tauri/target && sh scripts/verify.sh
# puts our own target path into the ps listing verify.sh is about to search. the old
# `grep -F "$REPO_ROOT/src-tauri/target"` then matched the caller, called it "ours",
# and skipped fmt+clippy+test — INCOMPLETE, exit 1, on an idle machine. false REFUSAL,
# not a false pass (a skip is loud), but it costs the whole rust tier and it may be
# behind some of the "3 green, 3 skipped" runs that were blamed on a live `tauri dev`.
#
# ⛔ the tempting alternative — only look at argv[0], so a path merely MENTIONED in a
# command line stops counting — was considered and REJECTED: a genuine `cargo build`
# has argv[0] of plain `cargo` and names our target nowhere in argv[0], so that rule
# stops recognising the exact case this whole function exists to detect.
#
# so: the pid chain from this script up to init, one pid per line, self first. those
# pids are the processes that STARTED us; none of them can be a build of ours that we
# would deadlock against, and every one of them may quote our paths.
#
# ⚠️ portability, probed 2026-09-27 rather than assumed, because this runs on windows
# (msys), macos and linux and the three do not agree on ANY single mechanism:
#   msys/cygwin  /proc/<pid>/ppid exists, is a one-line file, and works. `ps -o` does
#                NOT exist here at all — msys ps takes only -aefls/-u/-p/-W, so it
#                answers `-o` with a usage message on stderr and nothing on stdout.
#   linux        no /proc/<pid>/ppid file; /proc/<pid>/status has "PPid:<tab><n>".
#                /proc/<pid>/stat is deliberately NOT used — its second field is the
#                comm in parens, which may itself contain spaces and parens and so
#                shifts every column after it.
#   macos/bsd    no /proc at all; `ps -p <pid> -o ppid=` is the only way.
# an unreadable ppid ends the walk quietly, and the chain always contains at least
# $$ itself. a SHORT chain would be the one unsafe degradation — fewer lines dropped
# means erring back toward "ours", which is the bug — and the invariant that rules it
# out is this: the caller only reaches the walk after `ps -eo pid= -o args=` produced
# a pid-shaped listing, so this ps understands `-o`, so the macos arm of the walk
# (`ps -p <pid> -o ppid=`) understands it too. where `-o` is absent — msys — the
# listing never validates and we return "clear" without walking anything. that is the
# other half of the safety: a failed validation falls through to "clear" = the checks
# RUN. every failure path in this pair leans toward running the checks, never toward
# skipping them.
#
# the windows/powershell branch needs NO ancestor filter and deliberately does not get
# one: there, a command line only counts when the process is ALSO named cargo/rustc/
# rustdoc/rustup ($isRust) or its executable itself lives under our target/, and an
# agent's ancestor is bash.exe or node.exe, so it is discarded before its argv is ever
# read. do not "unify" the two branches by relaxing that test — the name check is what
# makes trap #1d impossible on windows.
verify_pid_chain() {
  _p=$$
  _n=0
  while [ "$_n" -lt 24 ]; do
    case "$_p" in
      ''|*[!0-9]*) break ;;
    esac
    [ "$_p" = 0 ] && break
    printf '%s\n' "$_p"
    if [ -r "/proc/$_p/ppid" ]; then
      _pp=$(cat "/proc/$_p/ppid" 2>/dev/null | tr -d '[:space:]')
    elif [ -r "/proc/$_p/status" ]; then
      _pp=$(awk '/^PPid:/ { print $2; exit }' "/proc/$_p/status" 2>/dev/null)
    else
      _pp=$(ps -p "$_p" -o ppid= 2>/dev/null | tr -d '[:space:]')
    fi
    [ "$_pp" = "$_p" ] && break
    _p=$_pp
    _n=$((_n + 1))
  done
}

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
  # arithmetic, and `ps -eo args=` stays byte-identical, which is what keeps bsd
  # (macos) and gnu (linux) both working.
  #
  # ⚠️ the snapshot now carries pids (`-o pid=` then `-o args=`, as two separate -o
  # flags: on bsd ps a `=` inside a COMMA list — `-o pid=,args=` — is read as "the
  # header of pid is the text ,args=", so the comma form silently loses the second
  # column on macos). that is what trap #1d above needs: the args column alone cannot
  # tell our own caller apart from a real build.
  #
  # ⚠️ argv CAN CONTAIN NEWLINES, and a newline inside a record would be fatal to a
  # one-line-per-process reading — so this was once a record parser: a line that did
  # not open with a pid was folded into the argv above it as a continuation. THAT
  # PARSER IS GONE, and it is gone on measurement, not on taste:
  #
  #   linux  procps-ng 4.0.4       a newline in argv prints as a SPACE.
  #                                `bash -c 'sleep 3<NL>LINE2'` reads back out of
  #                                `ps -o args=` as `bash -c sleep 3 LINE2`
  #                                (measured on zettaserver, confirmed with od -c).
  #   macos  27.0 / darwin 27.0.0  a newline in argv prints as the LITERAL four
  #          /bin/ps               characters \012. od -c shows `\ 0 1 2`, `wc -l`
  #                                says 1, and `sed -n l` ends the line at `LINE2$`
  #                                (measured on a real mac).
  #   msys   ps                    supports neither `-o` nor `args`, so it writes a
  #                                usage message to stderr and nothing to stdout —
  #                                the shape check below catches that and we RUN.
  #
  # so NO ps on any platform devgo supports splits one process across printed lines:
  # one printed line is one process, everywhere. the four-line argv record the parser
  # was built for was an artifact of the INSTRUMENT — msys ps has no `-o` and no
  # `args`, so the agent doing that measuring wrote a STAND-IN ps on windows out of
  # `/proc/*/cmdline`, and the shim emitted the embedded newline RAW. no real ps does.
  # ⭐ do not re-add the parser on a hunch. it was unreachable on both platforms, and
  # while it existed it carried a hole of its own: a continuation line that happened
  # to open with digits and whitespace (`123 files in <root>/src-tauri/target`) was
  # read as a record of pid 123, escaped the ancestor filter, and brought the false
  # "ours" — i.e. the rust skip — straight back.
  #
  # ⚠️ what the macos escape DOES change is MATCHING: those four characters travel
  # into whatever we compare against, so a pattern anchored on a SPACE matches on
  # linux and misses on a mac, and a test asserting "a newline becomes a space" would
  # pass on ci and fail there. checked for this function: the two tests that can
  # produce a skip — `index(a, <root>/src-tauri/target)` and the rust-analyzer name —
  # are literal substrings containing no whitespace, so neither is affected on either
  # platform. only the cargo/rustc TOKEN regex has whitespace in it, and the worst the
  # escape can do there is miss a token and so lose the `other` NOTE: the verdict then
  # falls to clear, which RUNS the checks. it cannot turn into a skip.
  #
  # ⚠️ scope of the macos measurement, honestly: one os version (27.0), /bin/ps, one
  # shell-quoted newline. a NUL or a tab in argv, `ps -ww`, and other `-o` formats
  # were NOT tested. nothing below depends on any of those.
  if command -v ps >/dev/null 2>&1; then
    procs=$(ps -eo pid= -o args= 2>/dev/null)
    # ⭐ validate the SHAPE before trusting a byte of it. msys ps answers `-o` with a
    # usage message; some other ps could answer with something else again. if the
    # first line does not open with a pid we did not get a process listing, and the
    # only safe reading of "I could not look" is "clear" → the checks RUN.
    if ! printf '%s\n' "$procs" | head -n 1 \
         | grep -Eq '^[[:space:]]*[0-9][0-9]*[[:space:]]'; then
      procs=''
    fi
    if [ -n "$procs" ]; then
      # the chain is read AFTER the snapshot on purpose: a `ps -p` spawned by the walk
      # cannot appear in a listing that was already taken.
      chain=$(verify_pid_chain | tr '\n' ' ')
      verdict=$(printf '%s\n' "$procs" | awk -v chain="$chain" -v root="$REPO_ROOT" '
        BEGIN {
          n = split(chain, c, " ")
          for (i = 1; i <= n; i++) if (c[i] != "") mine[c[i]] = 1
          target = root "/src-tauri/target"
          ours = 0; other = 0
        }
        # one line, one process. a line that does not open with a pid is attributable
        # to nobody, so it is DROPPED — never folded into the record above it. that
        # fold was the deleted parser, and folding argv onto a pid that did not print
        # it is exactly how a poisoned ancestor used to score ours.
        {
          if (!match($0, /^[ \t]*[0-9][0-9]*[ \t]/)) next
          # trap #1d: our OWN argv can name the target — an agent invokes verify with
          # the repo path on its command line — so every ancestor of this shell is
          # dropped before a byte of its argv is read. this is the whole reason the
          # pid column is requested at all.
          if (($1 + 0) in mine) next
          a = $0
          sub(/^[ \t]*[0-9][0-9]*[ \t]/, "", a)
          # the rust-analyzer filter comes first for the same reason as in the
          # windows branch: the editor holds no build lock, and the transient
          # cargo check it spawns would otherwise print a note on every run.
          if (a ~ /rust-analyzer/) next
          if (index(a, target) > 0) { ours++; next }
          # trap #1b on this branch too: rust work that names no path of ours is
          # not ours, so we RUN — but say so, exactly as the windows branch does.
          if (a ~ /(^|[\/ \t])(cargo|cargo-clippy|rustc|rustdoc)([ \t]|$)/) other++
        }
        END {
          if (ours > 0) print "ours"
          else if (other > 0) print "other"
          else print "clear"
        }
      ')
      case "$verdict" in
        ours|other|clear) printf '%s' "$verdict"; return 0 ;;
      esac
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

# is this dev dep actually installed in THIS tree? a LOCAL-TREE test on purpose,
# never `command -v vitest` and never `bunx vitest`: vitest, tsc and vite are dev
# deps and never land on PATH, and bunx would answer a missing one by DOWNLOADING
# it — a gate that installs its own checker is worse than one that skips. that
# reasoning is intact; only the spelling below changed.
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
# actually means, and `node_modules/<pkg>/package.json` is one spelling on all
# three platforms — no extension to guess, no shell retry in the answer. the .bin
# sweep after it is the fallback for a hoisted/linked layout, and it names every
# real spelling: extensionless symlink on mac and linux, .exe/.cmd/.ps1/.bunx on
# windows. neither branch can fetch anything.
#
# ⚠️ trap #2, last instance — this probe was vitest-only, and the two checks on
# either side of the vitest one need node_modules just as much. `bun run build` is
# `check:contrast && tsc && vite build`, which resolves tsc and vite out of
# node_modules/.bin, and `bun run` does NOT install a missing dep: on a tree with
# bun on PATH but no node_modules the build went RED one line below where vitest
# SKIPPED. `bun x tsc` fails the other way — bun x answers a missing typescript by
# DOWNLOADING it, the exact thing the paragraph at the top of this block refuses.
# so the helper takes the package and its .bin name, and all three checks ask it
# first. $1 = the package directory under node_modules, $2 = the .bin basename.
dep_installed() {
  [ -f "$REPO_ROOT/node_modules/$1/package.json" ] && return 0
  for _e in "" .exe .cmd .ps1 .bunx; do
    [ -f "$REPO_ROOT/node_modules/.bin/$2$_e" ] && return 0
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
  #
  # ⭐ and the probe is per-check, not per-tier: tsc is a dev dep like the other
  # two, so `bun` on PATH licenses the INVOCATION and dep_installed licenses the
  # TOOL. without it `bun x tsc` would quietly fetch typescript from npm and
  # "verify" the tree with a compiler this tree never pinned.
  if dep_installed typescript tsc; then
    run_check "tsc --noEmit" "$REPO_ROOT" bun x tsc --noEmit
  else
    skip "tsc --noEmit" "typescript not installed in node_modules — run bun install"
  fi
  # tier 1, not tier 3: the whole suite is ~2.5s cold, which is inside the
  # noise of the tsc line above it, and a test you only run before a main
  # push is a test that tells you about a break one commit too late.
  #
  # see dep_installed() above for why this is a local-tree file test and not
  # `command -v` — and for the msys `.exe` retry that made the old spelling lie.
  # a tree with no node_modules skips here the same way a shell with no bun does.
  if dep_installed vitest vitest; then
    run_check "vitest run" "$REPO_ROOT" bun run test
  else
    skip "vitest run" "vitest not installed in node_modules — run bun install"
  fi
  if [ "$FULL" -eq 1 ]; then
    # dist/ is gitignored and no dev server reads it (vite serves :1420 from
    # memory), so this build cannot disturb anything and needs no scratch dir.
    #
    # both halves of the script get probed: `bun run build` shells out to tsc AND
    # to vite, and a tree missing either one is a tree that cannot build — which
    # is a skip, not a red. (check:contrast runs on bun alone, already licensed.)
    if dep_installed typescript tsc && dep_installed vite vite; then
      run_check "bun run build" "$REPO_ROOT" bun run build
    else
      skip "bun run build" "typescript/vite not installed in node_modules — run bun install"
    fi
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
if [ "$EXECUTED" -eq 0 ] && [ "$RED" -eq 0 ]; then
  # skipping is fine per check; skipping ALL of them is a gate that verified
  # nothing, which is worse than no gate because it looks like a pass.
  #
  # ⭐ the `$RED -eq 0` half is what keeps this sentence TRUE now that a bad $dir
  # scores red without scoring executed (see trap #3 in run_check). without it,
  # six checks red on six missing directories would print "every check was
  # skipped" — a sentence that sends the reader hunting for skip reasons that do
  # not exist, and it would swallow the red count that names the real problem.
  # both paths still exit 1 and both are still loud, which is the property this
  # branch exists to hold; only the wording moves, to the branch that can count.
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
