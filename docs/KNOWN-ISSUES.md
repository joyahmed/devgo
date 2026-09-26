# Known issues

What DevGo gets wrong today, what you will see when it happens, and what to do instead. The current
release is v1.2.1.

Shipping a list like this is cheaper than the alternative for both of us: if you hit something here,
it is known and you do not need to write it up. Everything else is worth an
[issue](https://github.com/joyahmed/devgo/issues) — including the two entries below marked *not
reproduced*, where a second sighting is the whole thing that is missing.

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

## Keyboard navigation in the clone drawer

I hit these on Linux against v1.2.1, with a large repository list:

- With a few hundred repositories in the list, `Tab` cycles inside the list and never reaches the
  destination field below it. With one repository shown it reaches it fine. Use the pointer to reach
  the destination, or filter the list down first.
- A focused repository row draws no visible focus ring, so there is nothing on screen saying where
  `Tab` has got to.
- Typing a letter jumps to the first repository starting with it, but typing the same letter again
  does not advance to the next one. Type more of the name instead.

None of these lose data and none of them block cloning; they make it slower than it should be.

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

## Launching an agent or a dev script on macOS (v1.2.1 and earlier)

On a Mac, an app started from the Dock inherits launchd's four directories, not the PATH your shell
has. In v1.2.1 that reaches some launches: *Open in agent* (`Ctrl+Alt+Enter`) or *Run dev script…*
(`Ctrl+Shift+D`) can open a terminal that immediately says `command not found` for `claude`, `node`
or whatever the script calls, even though the same command works when you type it yourself.

It is worst on Ghostty, where the terminal is opened through `open` and the PATH repair never runs at
all. The next release fixes both halves. Until then, use Terminal.app or iTerm2 as the terminal
target for agent and dev-script launches — Settings › Editors & Terminals, or the footer's Terminal
group, which names the one each key will use.

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
| Linux | VS Code, xterm | `Ctrl+Enter` opened the project; `Shift+Enter` gave me a shell already sitting in the project directory |

Two things that table does not say on its own.

The macOS run was on a build carrying the PATH repair, and **v1.2.1 does not have it** — on the
release you downloaded, that lane is the entry above this one. And GNOME Terminal, the terminal a
stock GNOME desktop actually ships, *does* get started by DevGo on my Linux machine, but I have only
driven it over a remote X session, where it is a D-Bus-activated client and paints its window on
another seat. That is not DevGo's fault and it is not proof either, so I count it unconfirmed.

### What DevGo detects but I have never launched

I develop on Windows, macOS and Linux, and this is everything outside what those three have in front
of me:

| kind | I have not launched these |
|---|---|
| Editors | VS Code Insiders, Cursor, Windsurf, Zed, Sublime Text, IntelliJ IDEA, WebStorm, PyCharm, RustRover, GoLand, Fleet — and Neovim, Helix, Vim, Emacs and Micro, which are only offered inside a WSL distribution |
| Terminals | iTerm2, Ghostty, WezTerm, Kitty, Alacritty, Konsole, Xfce Terminal, Tilix, foot, Terminator (and GNOME Terminal, above) |
| Agents | Codex, OpenCode, Gemini CLI |
| File managers | Finder, the desktop default (`xdg-open`), Files (Nautilus), Dolphin, Nemo, Thunar, Caja, PCManFM |

**Untested is not broken.** Each of those is a program name plus a template I took from that program's
own manual, and I expect most of them to open exactly what you asked for the first time. I am listing
them because if one misbehaves you should know it is unproven rather than conclude the app is broken.

### If yours is in the second list

The failure to watch for is a quiet one: **a window opens and the command does not run**. Your editor
or terminal appears, in the right directory or the wrong one, and the agent or dev script you asked
for never starts, with no error — because DevGo has handed off by then, and what happens inside that
window belongs to the program that owns it. On a Mac, read the PATH entry above first: that is the
known cause, and Ghostty is the target I know is bad there.

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
