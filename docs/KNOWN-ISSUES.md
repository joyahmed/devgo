# Known issues

What DevGo gets wrong today, what you will see when it happens, and what to do instead. The current
release is v1.2.5.

Shipping a list like this is cheaper than the alternative for both of us: if you hit something here,
it is known and you do not need to write it up. Everything else is worth an
[issue](https://github.com/joyahmed/devgo/issues) — including the one entry below I have seen only
once and could not reproduce, where a second sighting is the whole thing that is missing.

Filing one: the [bug report form](https://github.com/joyahmed/devgo/issues/new/choose) asks for the
version and build sha (Settings › About), the platform, and the log (below) — that is what turns a
report into something fixable on arrival rather than a round trip to establish them first.

## The bottom action bar drops its key hints on a narrow window

All platforms. The footer measures the room it has and, when the strip no longer fits on one line, it
gives up one thing at a time in a fixed order rather than wrapping. In order: the key chips on the
launch buttons, then `Pin` and `Search`, then `Commands` and `Summon`, then the `Editor` / `Terminal`
/ `Agent` labels in front of each group. `Shortcuts` and `Help` never go, and a second line is only
the floor under all of that — the bar reaches it at a width nothing else on screen is usable at.

So the bar keeps its height and loses content, which is the opposite trade from the one this entry
used to describe. **The chips cost you nothing**: the button stays visible, named and clickable, its
tooltip still names the key, and Settings › Shortcuts lists every binding in the app. The three steps
after them do cost you something — `Pin`, `Search`, `Commands` and `Summon` are stated nowhere else
on the bar — but Shortcuts is one click away and never sheds, and the command palette
(`Ctrl+Shift+P`) lists the same actions with no bar at all.

The widths are not a setting and not a guess; they are whatever your row of targets measures. On my
Windows window, with VS Code and Zed, Windows Terminal and two Claude Code rows, the chips go below
about 2300, `Pin` and `Search` below about 1675, `Commands` and `Summon` below about 1430, the labels
below about 1000, and the second line arrives below about 870. More targets, or longer names, move
every one of those up.

That the bar sheds at all is deliberate — a bar that does not fit has to *drop* content, not shrink
it, because DevGo's text-size control is a zoom and scaling type to the window would fight the size
you chose in Settings. What is still wrong is how early the second step arrives: losing `Pin` at a
width you would call a normal window is a real loss of information, and the current spacing only
buys it down to the numbers above rather than solving it.

Workaround: widen or maximise the window, or press `Ctrl+Shift+P` — the palette names every action
the bar does and every key it stopped showing.

## The project search box clips its placeholder

Same cause, same conditions. Each lane's search box reserves room on the right for its key chips —
`CTRL+K` or `CTRL+G` for focus, `ENTER` for the action — and on a narrow window that reserve eats the
placeholder, so `Search local projects…` reads `Search lo`. The chips are the load-bearing half; the
placeholder is the half that gives way.

The box itself is fine: click it or press `Ctrl+K`, type, and it filters normally. The text only
looks cut before you have typed anything.

## Typing a letter does not jump to the next project

The project list does not respond to typing a letter to navigate to the next project starting with that letter — there is no type-to-jump feature here. All movement through the list uses arrow keys only.

To find a project by name, press `Ctrl+K` to open the search box and type there. The search filters the list as you type.

## The clone drawer has closed by itself once, and it has not happened again

I saw this once, on an installed 1.2.1 build: the GitHub *Clone into…* drawer was open, and about
ninety seconds later, with nothing typed or clicked in between, it was gone. If it happens to you, the
repositories you had ticked are lost — the drawer resets its selection when it closes; the
destination workspace survives.

I tried three times to make it happen again and could not, and there is nothing in the code that
closes a drawer except Escape, a click on the backdrop and the ✕ button. So I am writing it down as
unexplained rather than as a defect, because saying nothing would be worse.

If you see it: DevGo now writes a line to its log every time a drawer opens and closes, naming which
drawer, why it closed and how long it was open. Attach the log (below) to the issue and that line
says more than any description could.

## Installers are unsigned

Windows SmartScreen and macOS Gatekeeper will both stop the first launch and say they do not know who
made the app, because I have not signed it. This is expected, not a fault in the download, and the
way through on each platform is written out under **Install** in the [README](../README.md#-install)
— including the one macOS message (*"DevGo is damaged and can't be opened"*) that is **not** this and
that I do want to hear about.

## A custom file manager with no argument template cannot open anything

If you add your own file manager in Settings › Editors & Terminals and leave the arguments template
empty, choosing it refuses with *"<name> has no template for opening a folder"* rather than opening
the wrong thing. That message is correct — a program name on its own does not say how to hand it a
directory — but the empty field accepts the row in the first place, so it is easy to arrive here.

Fill the arguments template in, usually `"{path}"`.

## On macOS the window came back the wrong size — Stage Manager (fixed, with a loose end)

macOS only, and only with Stage Manager turned on. In v1.2.1: resize DevGo's window, quit, open it
again, and the window is not the one you left. Most often it comes back filling the screen — the
restore path's last resort is to maximise, so this usually presents as *"it came back maximized and
ignored my resize"*. Otherwise it comes back pushed 234px in from the left edge of the screen and, on
a 1920-wide display, 1686 wide no matter how wide you had made it. Either way the size you chose is
gone for good rather than just for that launch: the wrong window is what gets written back to disk,
so the next start repeats it instead of recovering.

Two separate faults were behind that and **both are fixed after v1.2.1 — with one loose end.** Your
window now comes back where you left it, and at the width you left it or a sliver under: an
**intermittent shortfall of 16 to 41px** on a 1920-wide display, which I cannot make happen on demand
and which is absent entirely most of the time I look. Nothing is lost in either case — the rectangle
on disk is correct and the window is in the right position; it is the width, sometimes, and only by a
sliver. The paragraph on it below says what would actually help.

**The cause is Stage Manager, which is also the workaround.** Stage Manager owns a strip down the left
of the display for its shelf of windows, and at the moment DevGo's window is first shown the window
server pins the window's left edge to the right of that shelf — 234px on my display — and cuts the
width down to what is left, 1920 − 234 = 1686. Nothing DevGo can read predicts it: macOS reports the
usable area of the screen as 1920×1050 and says nothing about the shelf. That is why the left edge came
back at 234 whatever I had saved — 0, 100 and 109 all became 234, at 1400, 1811 and 1910 wide — it is
the edge of the shelf, not a number derived from the window. It is not `center: true` either: centring
the configured 900-wide window on a 1920-wide screen gives 510, and only a 1452-wide window centres at
234. I proved the shelf with a small AppKit program of about forty lines, no DevGo and no Tauri in the
picture: setting size and position while the window is hidden is exact to the pixel, showing the
window is what turns 1910×1000 at (0,30) into 1686×1000 at (234,30), and setting the size once more
afterwards sticks.

**The save half, fixed after v1.2.1.** A resize that took the window close to the full width of your
monitor was saved nowhere at all — DevGo read it as the window having been maximised, and a maximised
window's own size is not a choice worth storing. Within 24px of the monitor's width was enough to
trigger that: on my 1920-wide display, 1897×1000 was discarded and 1895×1000 was kept. Nothing on
screen and nothing in the log said the save had been dropped. DevGo now measures against the usable
area of the screen as well as the whole panel, with the same 24px of slack on both, so an ordinary
window a few pixels short of full width is saved as what it is.

**The restart half, fixed after v1.2.1, with an intermittent shortfall nobody has pinned down yet.**
Fixing the save alone changed nothing you could see, because one relaunch then destroyed the value: the
shelf clamp above rewrote the window, and the resize the window server had just performed looked
exactly like one you had asked for, so it was saved over the good rectangle in `prefs.json`. DevGo now
applies your position and size a second time, once the window is actually on screen — the only moment
at which they stick. That is measured on the real app rather than reasoned about, and the position half
of it is solid: the left edge comes back at 0 where I left it, never at 234.

The width is the loose end, and the numbers refuse to line up into one story. Saving 1910, on one
machine, one display and one build: five restarts in a row gave 1869, 41px short and byte-identical
every time; a live `prefs.json` was later seen holding 1894, 16px short; and nine restarts in a row
gave 1910 exactly, with nothing changed between them and the five. **So the shortfall is not a fixed
amount, it is not always there, and I do not know what makes the difference.** It does not creep during
a session either, and that part I did go and check: a window measured at 1894×1000 @(0,30) was still
exactly that after switching away to Finder and back, and still that after eight seconds away. Whatever
this is happens at restore, once, and then holds.

What that means for you. If your window opens exactly as you left it, this entry is not stale — you are
in the case that works, which is the one I get every time I try at the moment. If it opens 16 to 41px
narrow, that is known: it costs you a sliver of width and nothing else, the position is right and the
file on disk is right. And the useful thing then is not a report saying *"16px short"* — I have that
number — but **a note of what you were doing**: how you had resized the window, what else was on
screen, whether the Mac had slept, how long DevGo had been closed. The trigger is the only missing
piece, and one clear account of it is worth more than the measurements above.

**Workaround for the clamp: turn Stage Manager off**, in System Settings › Desktop & Dock. It is the
thing that was doing the clamping, so a Mac that never had it on never had the 234px-and-1686-wide
window at all, and one with it turned off cannot get it again.

⚠️ That is **not** a fix for the intermittent shortfall, and I am not going to imply it is. The
shortfall comes and goes with Stage Manager left exactly as it was, so it is not simply the shelf in
miniature, and I have no measurement of it with Stage Manager off — I have no way to ask for it at all.
Leaving the window maximised does sidestep this entry end to end: that path stores a flag rather than a
rectangle, and a maximised window opens maximised.

What I measured, and what I did not. An M1 Max, **one** 1920×1080 display, scale factor 1.0, Dock set
to auto-hide, Stage Manager on. **This is not a Retina or scaling bug** — all of it fires at scale
factor 1.0, and the Retina theory was disproved by measurement rather than left open. Two or more
monitors, and a scale-2 display, are covered by unit fixtures and not by hardware, and a green fixture
is not a machine. Windows and Linux never had this and are not changed by the fix: the shelf is a macOS
feature, and on those two platforms the restore still runs the original code, kept verbatim behind a
compile-time guard.

## Launching an agent or a dev script on macOS (v1.2.1 and earlier)

On a Mac, an app started from the Dock inherits launchd's four directories, not the PATH your shell
has. In v1.2.1 that reached some launches: *Open in agent* (`Ctrl+Alt+Enter`) or *Run dev script…*
(`Ctrl+Shift+D`) could open a terminal that immediately said `command not found` for `claude`, `node`
or whatever the script calls, even though the same command worked when you typed it yourself.
Terminal.app and iTerm2 were fixed after v1.2.1.

Ghostty, WezTerm, Kitty and Alacritty kept a smaller version of it through v1.2.3: a dev script ran
on the emulator's own command line with no shell around it, so nvm, fnm or `brew shellenv` in your
`~/.zshrc` never loaded, and the window closed the moment the script ended. **v1.2.4 fixes that**:
those four now run a dev script the way Terminal.app does — through your own shell, which reads your
rc file first, and then leave you at your login shell in the project when the script stops.

**Ghostty is now confirmed, on a real Mac**: `bun run smoke` drove an installed v1.2.5 build through
Ghostty and watched it — nvm loaded, and the tab stayed at `/bin/zsh -l` when the script stopped,
same as Terminal.app. WezTerm, Kitty and Alacritty are still unwatched on real hardware, and so is
every Linux desktop terminal (GNOME Terminal and the rest) — the Linux box this has been driven on
so far is a headless server. If one of the still-unverified four opens and the script does not
start, that is the report I want — the log section below says what to attach. Until a given emulator
is confirmed, Terminal.app or iTerm2 remain the safe targets on a Mac: Settings › Editors &
Terminals, or the footer's Terminal group, which names the one each key will use.

## A dev script inside WSL could not find node (v1.2.3 and earlier)

Windows with WSL. *Run dev script…* on a project inside a distro opened a tab that failed at once
with `exec: node: not found`, or ran a `pnpm` that was not yours. The run line started a login shell
but not an interactive one, and Ubuntu's `~/.bashrc` stops early in a shell that is not interactive
— so nvm never loaded, and `pnpm` fell through to the Windows copy under `/mnt/c`, which cannot find
a node. **Fixed in v1.2.4**: the line now runs your interactive shell, finds the distro's own nvm
node, and when the script stops the tab stays in your login shell — zsh if zsh is yours — rather than
a bare bash.

One thing to know if you ever edited a terminal row by hand. DevGo moves the rows it shipped to the
new line on first launch, but only rows that still match what it shipped byte for byte, and it saves
a copy of `targets.json` beside the original before it touches anything. A row you changed yourself
is left exactly as you wrote it, which also means it keeps the old behaviour. If a WSL dev script
still says `node: not found` on v1.2.4, check that row first in Settings › Editors & Terminals.

## Install and a dev script for the same project could collide (v1.2.4 and earlier, macOS and Linux)

On macOS and Linux, the run script DevGo writes for a launch was named after the project alone, not
the command. Running **Install** and *Run dev script…* for the same project close together made both
write to that one file: whichever ran second overwrote it, and if the first had already deleted its
copy after running, the second command's tab failed with `No such file or directory` instead of
running. **Fixed in v1.2.5**: the filename now also hashes the command, so Install and a dev script
each get their own file and no longer step on each other.

## macOS builds are Apple Silicon only

The macOS download is built for arm64. There is no Intel build and no universal one yet — an Intel
Mac cannot run it, and I have not decided which of the two to add. Building from source (README,
**Install**) works on either.

## What I have actually launched, and what DevGo only detects

DevGo knows about forty-five programs — seventeen editors, fourteen terminals, four coding agents and
ten file managers — and it finds each of them the same way: a name on `PATH`, an application bundle on
a Mac, a Start Menu shortcut on Windows. That search is all detection is. Whether the *launch* works
is a separate question, answered by the argument template stored beside the name, and I wrote most of
those templates from the program's own documentation without ever running them.

The macOS entry above is what happens when those two get confused: a terminal DevGo detected perfectly
opened a window and dropped the command on the floor. So rather than let the list imply I have driven
all of it, here is what I have and have not.

### What I have launched, from an installed build

| platform | target | what I saw |
|---|---|---|
| Windows | Trove, File Explorer | right-clicked a project, chose *Reveal in Trove*: the process started with the project's parent folder in its window title. The explicit *Reveal in File Explorer* row opens Explorer. |
| Windows | VS Code, Windows Terminal, Claude Code | I use these every day, so they are the paths I exercise constantly — a different kind of evidence than the row above, and a much stronger one than anything below |
| macOS | Terminal.app with Claude Code | *Open in agent* opened a Terminal window that ran `claude` in the project |
| macOS | Ghostty, dev script | `bun run smoke` drove *Run dev script…* through Ghostty on an installed v1.2.5 build: nvm loaded, and the tab stayed at `/bin/zsh -l` when the script stopped |
| Linux | VS Code, xterm | `Ctrl+Enter` opened the project; `Shift+Enter` gave me a shell already sitting in the project directory |

Two things that table does not say on its own.

The macOS run was on a build carrying the PATH repair, which v1.2.1 did not have and every release
since does. And GNOME Terminal, the terminal a
stock GNOME desktop actually ships, *does* get started by DevGo on my Linux machine, but I have only
driven it over a remote X session, where it is a D-Bus-activated client and paints its window on
another seat. That is not DevGo's fault and it is not proof either, so I count it unconfirmed.

### What DevGo detects but I have never launched

I develop on Windows, macOS and Linux, and this is everything outside what those three have in front
of me:

| kind | I have not launched these |
|---|---|
| Editors | VS Code Insiders, Cursor, Windsurf, Zed, Sublime Text, IntelliJ IDEA, WebStorm, PyCharm, RustRover, GoLand, Fleet — and Neovim, Helix, Vim, Emacs and Micro, which are only offered inside a WSL distribution |
| Terminals | iTerm2, WezTerm, Kitty, Alacritty, Konsole, Xfce Terminal, Tilix, foot, Terminator (and GNOME Terminal, above) |
| Agents | Codex, OpenCode, Gemini CLI |
| File managers | Finder, the desktop default (`xdg-open`), Files (Nautilus), Dolphin, Nemo, Thunar, Caja, PCManFM |

**Untested is not broken.** Each of those is a program name plus a template I took from that program's
own manual, and I expect most of them to open exactly what you asked for the first time. I am listing
them because if one misbehaves you should know it is unproven rather than conclude the app is broken.

### If yours is in the second list

The failure to watch for is a quiet one: **a window opens and the command does not run**. Your editor
or terminal appears, in the right directory or the wrong one, and the agent or dev script you asked
for never starts, with no error — because DevGo has handed off by then, and what happens inside that
window belongs to the program that owns it. On a Mac, read the macOS entry above first: Ghostty,
WezTerm, Kitty and Alacritty had exactly this failure through v1.2.3. The fix is confirmed on
Ghostty on real hardware; WezTerm, Kitty and Alacritty are still tested but not yet watched.

The log will go a long way here. Every launch you ask for writes two lines: what DevGo was about to
run, and whether the spawn was accepted or refused. Between them they say which of the two failures
you hit — if there is no "started" line, the program never ran and the refusal names why; if there
is one, the window opened and whatever went wrong happened inside it, which is the case above. On a
Mac the first line also names the script DevGo generated, and reading that file shows you the PATH
it set.

Send the log and, if you can, say which program, whether a window appeared, whether it was in the
right directory, and what it printed. That is enough for me to move the row from the second table to
the first.

Until then, Settings › Editors & Terminals will point the agent and dev-script keys at anything in
the first table.

## `bun run smoke` has now run on all three platforms

For anyone building DevGo themselves. `bun run install:local` rebuilds, reinstalls and relaunches
DevGo on all three platforms, and `bun run smoke` then checks, without driving a window, that the
running build is the one you just made and that its dev menu lines find your node. As of v1.2.5,
smoke has passed on an installed build at the same commit on all three: macOS 5 of 5, Linux
(a headless Ubuntu server, not a desktop) 5 of 5, and Windows with WSL 8 of 8. That confirms the
dev menu's node-finding and shell behaviour on each platform's own smoke checks; it does not stand
in for watching a GUI terminal emulator open a window by hand — the entry above says which of those
are and are not confirmed that way.

## The log, and why attaching it helps

DevGo keeps one small log beside its config, capped at 1 MiB with one rotated copy. It records every
launch you ask for and every refusal, and it carries the version, the OS and the reason — the things
a bug report otherwise costs a round trip to establish. It does not record scans, refreshes or
anything that runs on its own.

| | |
|---|---|
| Windows | `%APPDATA%\app.zetta.devgo\devgo.log` |
| macOS | `~/Library/Application Support/app.zetta.devgo/devgo.log` |
| Linux | `~/.local/share/app.zetta.devgo/devgo.log` (or `$XDG_DATA_HOME/app.zetta.devgo/devgo.log`) |

Settings › Help › *Reveal in Explorer* (Finder, your file manager) opens that folder. The log holds
paths you opened and target names you configured, and nothing else — read it before you attach it if
that matters to you.
