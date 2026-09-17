# 72 — Where a Server Opens

**Branch:** `72.server-terminals` — `git checkout 72.server-terminals` gives you this chapter's finished app; `git diff efeeb30 72.server-terminals` is exactly what this chapter adds.

**Starting from:** `main` after 71 and the three docs/brand commits (`efeeb30`). Written from the public work itself.

**Goal:** a server row gets the choice a project row has had since 25. The ask, 2026-09-16: *"we give option to open with tmux. i may want to open it with windows terminal, psmux, wsl, or tmux."* Until now Enter on a server ran one line — the default terminal's run template with the ssh line, and the row's `tmux` flag decided whether that line attached a tmux session on the box. Two halves were folded into one button. Now they are two things you can see: the **local host** (the footer's Terminal group — every terminal target, then **psmux** and **WSL**) and the **remote half** (the *tmux on the box* chip beside it — the same per-server flag, now a click). The row menu and the palette list the same hosts; `Shift+Enter` on a server row is the default terminal.

## Also since 71

The straight-on-main commits between `4bbeb0e` (`✅STAGE: 71 screenshots`, the marker that sits on `main` only; 71's branch tip is `3d3bc94`) and this branch — the *branch = it gets a chapter* rule.

- `ac5fe2f ✅DOCS: readme shows the app` — the README's `<!-- screenshots -->` marker replaced by the 71 set.
- `4a46fe9 ✅DOCS: readme with an icon, badges and a face` — the Mac's; the README's head, root `README.md` only.
- `efeeb30 ✅UI: the brand mark is an svg, not a shrinking glyph` — the Mac's; the ✦ in `TitleBar.tsx` is a 16 px inline SVG (the font glyph rendered tiny on the Mac). On Windows it reads the same size as before, a touch crisper.

> **Hold on to:**
> 1. **The line before the spawn.** `launch_with_command` split into `run_line` (what would be spawned) and the spawn. Everything that wants to *show* a launch — a preview, a test, a report — reads the line; nothing has to fake a process. `open_server` now returns the line and takes `preview`, so a verify reads four strings instead of opening four terminals.
> 2. **A host is not a target.** psmux and WSL are not entries in `targets.json`; they are ways of running the ssh line *through* the default terminal target. Rust says so with an enum (`ServerVia::{Terminal, Psmux, Wsl}`) beside the optional target id, and the footer says so with a `TargetChoice` that is either a target or a host. A fake target with a fake template would have leaked into Settings › Editors & Terminals.
> 3. **Blocked with a reason, never a boot.** The WSL host takes the default distro and the *running* list the caller read (through the memo, never `wsl -d`). A stopped distro is `WslNotRunning(name)`, and the footer greys the button with the same words before the click. The launcher must never be the thing that starts a virtual machine.

> Rust: `#[serde(rename_all = "snake_case")]` on a unit enum makes `"psmux"` and `"wsl"` on the wire; `Option<ServerVia>` on the command means the frontend's `null` and a missing key are both the terminal.

---

## 72.1 — The run line before the spawn

`launcher.rs`: `launch_with_command` becomes two lines, and the body it had moves under a new name:

```rust
/// Open a terminal that runs a command in the project directory.
pub fn launch_with_command(
    target: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
    command: &str,
) -> Result<(), AppError> {
    let (exe, args) = run_line(target, project, info, command)?;
    spawn_raw(&exe, &args)
}

// what launch_with_command spawns, before the spawn: a caller that only
// wants to show the line reads it here
pub fn run_line(
    target: &LaunchTarget,
    project: &Project,
    info: &RuntimeInfo,
    command: &str,
) -> Result<(String, String), AppError> {
    // …
```

Nothing else changes; the Mac's `run_script_args` still writes its `.command` file inside `run_line` (a preview on a Mac writes the file too — a file is a cheap side effect, a terminal is not).

> `✅LAUNCHER: the run line before the spawn`

## 72.2 — A psmux session that runs one command

`build_psmux_script` (28) brings a *project's* session up: windows by name, no command in any of them. A server wants the opposite: one window, and the window *is* the ssh. psmux, like tmux, takes a shell command as the last argument of `new-session`, so the script is short:

```powershell
Set-Location -LiteralPath 'C:\Users\joy'
if (-not (Get-Command psmux.exe -CommandType Application -ErrorAction SilentlyContinue)) {
    Write-Host 'DevGo: psmux is not installed, so this is a plain ssh. For a session: winget install marlocarlo.psmux'
    ssh -t box tmux new-session -A -s devgo
    return
}
$PSNativeCommandUseErrorActionPreference = $false
psmux.exe has-session -t '=ssh-box' 2>$null
if ($LASTEXITCODE -ne 0) {
    psmux.exe new-session -d -s 'ssh-box' -n 'ssh' 'ssh -t box tmux new-session -A -s devgo'
}
psmux.exe attach -t '=ssh-box'
```

`build_psmux_command_script(session, windows_path, command)` under `#[cfg(any(windows, test))]`, beside the project one: the same `Get-Command psmux.exe -CommandType Application` bail (28's profile-alias lesson), the same `=` exact target, `ps_quote` on everything. The second launch finds the session and attaches — the shell already open on the box, not a second ssh. No psmux is the line run plain in the `-NoExit` shell.

Probed first: `psmux.exe new-session -d -s t72 -n w "ping -n 20 127.0.0.1"` → `list-windows -F '#W #{pane_current_command}'` said `w PING`; `kill-server`. (⚠️ `psmux.exe new-session --help` prints the version and *creates a session* — do not use it as a help.)

## 72.3 — `ServerVia` and `server_line`

```rust
// where a server's ssh line runs on this machine: the terminal's own run
// form, a psmux session whose window runs it, or the default distro's ssh
// through the terminal's wsl run form. the remote half, tmux on the box
// or a plain shell, is the server's own flag and lives in the line
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerVia {
    Terminal,
    Psmux,
    Wsl,
}

// …

// the line for a server through one of the local hosts. home is the
// stand-in project (a server is not a folder here; the terminal's {path}
// is the home directory). running is the live distro list, read by the
// caller without booting anything: a stopped default distro is a refusal,
// never a boot
pub fn server_line(
    target: &LaunchTarget,
    home: &Project,
    info: &RuntimeInfo,
    command: &str,
    via: ServerVia,
    running: &[String],
) -> Result<(String, String), AppError> {
    match via {
        ServerVia::Terminal => run_line(target, home, info, command),
        ServerVia::Psmux => psmux_line(target, home, command),
        ServerVia::Wsl => {
            let distro = info
                .default_distro
                .clone()
                .ok_or_else(|| AppError::NoWslDistro(home.name.clone()))?;
            if !super::platform::wsl::is_running(&distro, running) {
                return Err(AppError::WslNotRunning(distro));
            }
            // ~ is wsl's own spelling of the distro user's home, and the
            // line runs under bash -lc, so it is the distro's ssh and the
            // distro's ~/.ssh that answer
            target
                .resolve_run(
                    &home.full_path,
                    Some((&distro, "~")),
                    &escape(command),
                )
                .ok_or_else(|| AppError::TargetCannotRun(target.name.clone()))
        }
    }
}
```

- **Terminal** is 47's line: the run template with the ssh line as the tab.
- **Psmux** (`#[cfg(windows)]`) resolves the terminal's *session* form (`args_template`, the one with `{script}`), writes `devgo-ssh-<name>.ps1` into the seam, and refuses a terminal whose template has no seam with a new `TargetCannotHost`. The non-windows twin returns that same error: psmux is a Windows thing, and a Mac's Terminal.app is already the row's own button.
- **Wsl** is the terminal's *WSL run* form with `{linux_path}` = `~` — wsl.exe's own spelling of the distro user's home — and the command escaped for the `bash -lc "…"` it sits in. So it is the distro's `ssh`, the distro's PATH and the distro's `~/.ssh` that answer; the `wt` line reads `wsl -d Ubuntu --cd "~" -e bash -lc "ssh -t box tmux new-session -A -s devgo\; exec bash"` (53's escaped semicolon). `running` is passed in, not read here: the command reads it through `running_distros_memo()`, the tests hand in a list.

`error.rs`: `TargetCannotHost(String)` — *{0} has no session form, so it cannot hold a psmux session*; `WslNotRunning(String)` — *{0} is not running. DevGo never boots a distro for a terminal; start it first*.

`commands.rs`, `open_server(id, target_id, via, preview) -> Result<String>`: the stand-in home project as before, `resolve_target(Terminal, target_id)` as before, the liveness read **only when `via` is `Wsl`**, then `server_line`; `spawn_raw` unless `preview`; the line `"{exe} {args}"` comes back either way. The frontend's existing `invoke('open_server', { id, targetId: null })` still means the default terminal.

The builder, the enum, the line and the command went in one commit (a builder with no caller is a dead-code warning; the gate is 0).

> `✅SERVERS: open a server through a local host`

## 72.4 — Tests

Five, in `launcher.rs`: the psmux command script (`-s 'ssh-box' -n 'ssh' '<line>'`, `attach -t '=ssh-box'`, the bail runs the line plain, no `new-window`); the terminal host through the seeded `wt` (`-d "C:\Users\joy" ssh -t box tmux new-session -A -s devgo`); the psmux host (`pwsh -NoExit … -File "…devgo-ssh-box.ps1"`, the line *not* on wt's command line but inside the file, and a template without `{script}` → `TargetCannotHost`); the WSL host through `wt` (the exact `wsl -d Ubuntu --cd "~" -e bash -lc "…\; exec bash"` line); and the refusals — a running list without the default distro → `WslNotRunning("Ubuntu")` whose message says *never boots*, no default distro → `NoWslDistro`, and the case-insensitive match (`ubuntu` runs `Ubuntu`). The three `wt` ones are `#[cfg(windows)]` (the seed is); the refusal test builds its own target and runs on a Mac too.

> `✅TEST: a server through wt, psmux and wsl` — **209** (204 + 5).

## 72.5 — Types, hook, footer

`types.d.ts`: `ServerVia = 'psmux' | 'wsl'`; `TargetChoice { id, name, title?, blocked? }` — one button in a footer group, a target or not, `blocked` being the reason it is disabled; `ServerHost extends TargetChoice { targetId?, via? }`; `StatusBarProps` gains `server`, `serverHosts`, `onServerHost`, `onServerTmux`; `ProjectTreeProps` gains `onServerCursor`. `TargetGroupProps.items` becomes `TargetChoice[]` and loses `isWsl` (moved into the StatusBar commit so every commit type-checks).

`useLaunchActions` gains the server branch, the shape of `openTerminal`:

```ts
	// a server row: the ssh line through a local host. no id is the default
	// terminal, the same rule as above; via picks psmux or wsl through it.
	// the line comes back, and preview reads it without a launch
	const openServer = (server: Server, host?: ServerHost, preview = false) =>
		invoke<string>('open_server', {
			id: server.id,
			targetId: host?.targetId ?? null,
			via: host?.via ?? null,
			preview
		});
```

`StatusBar.tsx`: `choiceOf(t, isWsl)` is the old inline `blocked`/title logic as a function returning a `TargetChoice`; `TargetGroup` now maps choices and knows nothing about kinds. With `server` set the groups are one — `Terminal` over `serverHosts`, `defaultId` the default terminal, the terminal key as the chip, `onPick` finding the host by id (no id = the default) — and *Open both* gives its place to the **tmux on the box** chip: a `target` Button with `aria-pressed={server.tmux}` and `on`/`off` in muted text, title *Attaches a tmux session on box. Click for a plain login shell* / the inverse. Without `server`, the three groups as before.

> `✅TYPES: server hosts and the footer's choice` · `✅HOOKS: open a server through a host` · `✅UI: the footer follows a server row`

## 72.6 — The tree says which server, App wires it

`ProjectTree.tsx`: `selectServer` calls `onServerCursor?.(s)` and `clearCursors` calls it with `null` — the footer is told on the way in and out. (After the frames, one more line: `selectFolder` calls it with the folder's server, so browsing a server's folders keeps its hosts in the footer; it went straight on `main`, `4aa9ffa`.)

`App.tsx` keeps the **id**, not the object (`serverCursorId`; `serverSel` is found in `servers.servers` every render) — the tmux toggle reloads the list and the row object with it. The hosts:

```ts
	const distro = runtime.default_distro;
	const wslBlocked = isMac
		? 'No WSL on a Mac'
		: !runtime.wsl_available || !distro
			? 'No WSL distro on this machine'
			: !wsl.distros.some(d => d.toLowerCase() === distro.toLowerCase())
				? `${distro} is not running`
				: undefined;
	const serverHosts: ServerHost[] = [
		...targets.terminals.map(t => ({ id: t.id, name: t.name, targetId: t.id })),
		...(isMac
			? []
			: [
					{
						id: 'psmux',
						name: 'psmux',
						via: 'psmux' as const,
						title: 'A psmux session on this PC whose window runs the ssh line'
					},
					{
						id: 'wsl',
						name: 'WSL',
						via: 'wsl' as const,
						title: `ssh from inside ${distro ?? 'the default distro'}, with its own keys`,
						blocked: wslBlocked
					}
				])
	];
```

`wsl.distros` (62's `WslState`) is the *running* list, the same fact Rust checks. `openServer(s, host?)` flashes the terminal button and calls the hook; `setServerTmux(s, on)` is `servers.update({ ...s, tmux: on })` with a toast (*box: a tmux session on the box from now on* / *a plain shell on the box from now on*). The `copied` branch of `runServerAction` opens the default terminal through the same hook. `ProjectTree` gets `onServerCursor`, `StatusBar` gets the four props.

> `✅UI: the tree says which server is under the cursor` · `✅UI: a server row launches through a host`

## 72.7 — Menu, palette, key

`hostEntries(s)`: *Open in Windows Terminal · Enter* (the default terminal carries the key), *Open in psmux*, *Open in WSL* (disabled, its hint the reason), then *tmux on the box · on|off*. They replace the single *Open terminal* line at the top of the server menu, after the Lane heading.

The palette: per server × host `Server: open box in Windows Terminal` (subtitle `ssh box`, or the reason when blocked, disabled with it), and `Server: box tmux on the box off` (subtitle *A plain login shell on the box from now on*). The old `server.open.<id>` entry is gone; nothing persisted its id.

`Shift+Enter`: App's handler gains, before the `if (!selected) return`, `if (serverSel && fire('openTerminal', () => openServer(serverSel))) return;` and `serverSel` in the effect's deps — HMR kept the old closure until `location.reload()`, as 58 learned. `Ctrl+Alt+Enter` is untouched: agents belong to projects. The shortcut label stays *Open terminal* (the README's keyboard table mirrors it); the README's Servers section got the paragraph instead.

> `✅UI: the server menu lists its hosts` · `✅UI: palette entries per server host` · `✅KEYS: shift enter on a server row` · `✅DOCS: readme says where a server opens`

## 72.8 — Verify

`cargo test` **209**, `cargo check` 0 warnings, `cargo fmt --check` clean, `tsc -b` and `bun run build` clean. The dev build over CDP on 9223, a real `servers.json` (`box` + `lanbox`, tmux on, one terminal target `wt`), 2560×1392; the sixteen app-data files backed up by hash first (`bk72\`), the installed DevGo stopped, no distro running and none started (`wsl -l --running` read once: *no running distributions*).

- **The footer on `box`:** labels `Terminal · on`; buttons `Windows Terminal Shift+⏎` (`aria-current`), `psmux` (title *A psmux session on this PC whose window runs the ssh line*), `WSL` **disabled**, title *Ubuntu is not running*, and `tmux on the box · on` with `aria-pressed=true`. Back on a project row: `Editor · Terminal · Agent` and *Open both*.
- **The four lines, by `preview: true`** (`user@host` stands for the alias): terminal/`wt` → `wt -d "C:\Users\<you>" ssh -t user@host tmux new-session -A -s devgo`; psmux → `wt -d "C:\Users\<you>" pwsh -NoExit -ExecutionPolicy Bypass -File "…\Temp\devgo-ssh-box.ps1"` and the file holds `psmux.exe new-session -d -s 'ssh-box' -n 'ssh' 'ssh -t user@host tmux new-session -A -s devgo'` + `attach -t '=ssh-box'`; WSL → refused, *Ubuntu is not running. DevGo never boots a distro for a terminal; start it first* (the line itself is the unit test's: `wsl -d Ubuntu --cd "~" -e bash -lc "ssh -t … \; exec bash"`, PROVED-BY-STRING).
- **The chip:** click → `tmux on the box · off`, `aria-pressed=false`, toast *box: a plain shell on the box from now on*, the preview line `wt -d "C:\Users\<you>" ssh user@host`; click → `on`, the attach line back; `servers.json` `tmux: true` again.
- **The row menu** (a real right-click): `Show connection details · Open in Windows Terminal Enter · Open in psmux · Open in WSL Ubuntu is not running (disabled) · tmux on the box on · List folders & apps · …` — then the declared actions as before.
- **The palette:** `Server: open box in Windows Terminal | ssh box`, `… in psmux | ssh box`, `… in WSL | Ubuntu is not running` (disabled), `Server: box tmux on the box off | A plain login shell on the box from now on`; the same four for `lanbox`.
- **`Shift+Enter` on the row, PROVED-BY-REFUSAL:** a throwaway terminal target `Nope72` (`executable: devgo-nope-72`) made the default; the key on the `box` row → toast *devgo-nope-72 is not installed, or not on PATH…* — the server branch fired, the spawn never happened. Target removed.
- **One real launch — psmux:** the default terminal swapped for a throwaway `pwsh -WindowStyle Hidden -NoExit … -File "{script}"` target so no tab lands in the real Windows Terminal; the footer's `psmux` button clicked by a CDP mouse event → `psmux.exe list-sessions`: `ssh-box: 1 windows … (attached)`, `list-windows -F '#W #{pane_current_command}'`: `ssh ssh`, an `ssh.exe` alive, and on the box `tmux ls` said `devgo … (attached)`. Then `psmux.exe kill-server`, the young `pwsh`/`ssh` stopped, the box's `devgo` session back to detached (it predates this chapter — nothing killed there), `psmux.exe list-sessions` empty, 0 `psmux`/`ssh` processes. (⚠️ the stop-by-age filter caught its own shell once — exclude `$PID`.)
- Sixteen files restored by hash — **16 OK, 0 mismatches**, `window_transparency` 20, `show_server_details` absent; `bk\` untouched; the temp `devgo-ssh-*.ps1` removed.

> `✅STAGE: 72 server-terminals`; fetch, rebase onto the Mac's `efeeb30`, re-gate (209, 0 warnings), ff-merge; push `main` + branch.

## 72.9 — Deferred

- A **folder row's** footer hosts open the *server* (home), not the folder — Enter on the folder still opens the folder's session. Hosts for `open_server_folder` would be the same enum on that command.
- The Mac's local multiplexer is tmux: a *Session* host there (a tmux session whose window runs the ssh) is the symmetric thing; not typed, not run.
- A second server with the same name shares the psmux session `ssh-<name>` (the session is named from the stand-in's name, not the id).

---

## What you built

```
src-tauri/src/services/launcher.rs     run_line, ServerVia, server_line, psmux_line (+ mac twin), build_psmux_command_script, 5 tests
src-tauri/src/error.rs                 TargetCannotHost, WslNotRunning
src-tauri/src/commands.rs              open_server(id, target_id, via, preview) -> String
src/types.d.ts                         ServerVia, TargetChoice, ServerHost; StatusBarProps, TargetGroupProps, ProjectTreeProps
src/hooks/useLaunchActions.ts          openServer(server, host?, preview)
src/components/StatusBar.tsx           choiceOf, TargetGroup over choices, the server group, the tmux chip
src/components/ProjectTree.tsx         onServerCursor from selectServer / clearCursors (and selectFolder, on main)
src/App.tsx                            serverCursorId, serverHosts, openServer, setServerTmux, hostEntries, palette, Shift+Enter
README.md                              the Servers section: local hosts and the chip
```

- **A server row has hosts** — every terminal target, psmux, WSL — in the footer, the menu and the palette, each a line you can read before it runs.
- **The remote half is a chip** — *tmux on the box*, the server's own flag, one click.
- **WSL is never booted for a terminal** — blocked with the distro's name, in the footer and in Rust.
- **The line comes back** — `open_server` returns what it ran, and `preview` reads it without running.
