# Known issues

What DevGo gets wrong today, what you will see when it happens, and what to do instead. The current
release is v1.2.1.

Shipping a list like this is cheaper than the alternative for both of us: if you hit something here,
it is known and you do not need to write it up. Everything else is worth an
[issue](https://github.com/joyahmed/devgo/issues) — including the two entries below marked *not
reproduced*, where a second sighting is the whole thing that is missing.

## The bottom action bar wraps on a narrow window

All platforms. Make the window narrow enough — a 1920-wide screen is enough if you do not maximise —
and the footer's key hints no longer fit on one line. The Editor / Terminal / Agent group keeps line
one and the rest (Pin, Search, Commands, Summon, Shortcuts, Help) folds onto a second, and the bar
doubles in height. Nothing is lost: every hint is still there, every key still works, and the command
palette (`Ctrl+Shift+P`) lists the same actions with no bar at all.

Cosmetic, and the fix is not the obvious one. A bar that does not fit needs to *drop* content at
narrow widths, not shrink it — DevGo's text-size control is a zoom, so scaling type to the viewport
would fight the size you chose in Settings. That is why this is still open rather than patched.

Workaround: widen or maximise the window. There is no setting that hides the footer's key hints, so
the palette is the other way round the bar when the window has to stay narrow.

## The project search box clips its placeholder

Same cause, same conditions. Each lane's search box reserves room on the right for its key chips —
`CTRL+K` or `CTRL+G` for focus, `ENTER` for the action — and on a narrow window that reserve eats the
placeholder, so `Search local projects…` reads `Search lo`. The chips are the load-bearing half; the
placeholder is the half that gives way.

The box itself is fine: click it or press `Ctrl+K`, type, and it filters normally. The text only
looks cut before you have typed anything.

## The clone drawer has closed by itself once, and it has not happened again

Seen once on an installed 1.2.1 build: the GitHub *Clone into…* drawer was open, and about ninety
seconds later, with nothing typed or clicked in between, it was gone. If it happens to you, the
repositories you had ticked are lost — the drawer resets its selection when it closes; the
destination workspace survives.

Three deliberate attempts to make it happen again failed, and there is nothing in the code that
closes a drawer except Escape, a click on the backdrop and the ✕ button. So this is recorded as
unexplained rather than as a defect, because saying nothing would be worse.

If you see it: DevGo now writes a line to its log every time a drawer opens and closes, naming which
drawer, why it closed and how long it was open. Attach the log (below) to the issue and that line
says more than any description could.

## Keyboard navigation in the clone drawer

Seen on Linux against v1.2.1, with a large repository list:

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
made the app, because nobody signed it. This is expected, not a fault in the download, and the way
through on each platform is written out under **Install** in the [README](../README.md#-install) —
including the one macOS message (*"DevGo is damaged and can't be opened"*) that is **not** this and
should be reported.

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

## The log, and why attaching it helps

DevGo keeps one small log beside its config, capped at 1 MiB with one rotated copy. It is written
when something refuses, and it carries the version, the OS and the reason — the things a bug report
otherwise costs a round trip to establish.

| | |
|---|---|
| Windows | `%APPDATA%\app.zetta.devgo\devgo.log` |
| macOS | `~/Library/Application Support/app.zetta.devgo/devgo.log` |
| Linux | `~/.local/share/app.zetta.devgo/devgo.log` (or `$XDG_DATA_HOME/app.zetta.devgo/devgo.log`) |

Settings › Help › *Reveal in Explorer* (Finder, your file manager) opens that folder. The log holds
paths you opened and target names you configured, and nothing else — read it before you attach it if
that matters to you.
