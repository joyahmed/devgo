# 44 — Your Terminal Is Still There (post-plan)

**Branch:** `44.live-sessions` — `git checkout 44.live-sessions` gives you this chapter's finished app; `git diff 43.lane-cards 44.live-sessions` is exactly what this chapter adds.

**Starting from:** chapter 43 — the groups are cards. Since chapter 26 a terminal launch has opened a named tmux (WSL) or psmux (Windows) session, and since then a second launch has *reattached*: the scripts do `has-session` → create-if-missing → reconcile windows → `attach`. Close DevGo, close the terminal, reboot the distro — the session is where you left it. Nothing on screen said so.

**Goal:** read which projects have a live session, say it on the row, make the verb honest, and give the session a way to die.

> **Hold on to:**
> 1. **A read, a chip and a label — not a launch path.** The reattach already happens; this chapter makes it visible. Nothing under the label changes.
> 2. **One name, one function.** `session_names` is the launcher's own `tmux_session_name` over every project, so a session created on launch and a session found by `tmux ls` agree by construction.
> 3. **Rule 1, again.** A stopped distro is never asked; it has no session as far as DevGo is concerned, and `kill` refuses it rather than booting it.
>
> Rust: `pub(crate)` to widen a private function to its sibling module; `let Ok(out) = … else { return … }` (let-else) for "a missing binary is an empty list, never an error"; `HashSet` to ask each running distro once. TypeScript: a `Set<string>` in the hook, read with the badges on the same focus cooldown.

> The first draft of this chapter proposed "the terminal verb becomes Reattach — `attach` instead of `new-session`", and the code said *that already happens*.

---

## 44.1 — The names

`launcher.rs`: `tmux_session_name` becomes `pub(crate)`, and `session_names(projects) -> HashMap<String, String>` maps every project's session name to its `full_path`.

> `✅LAUNCH: session names for every project`

## 44.2 — The read

`services/sessions.rs`. `collect(projects, running) -> Vec<String>`: one `tmux ls -F '#S' 2>/dev/null` per **running** distro that owns a project, through `wsl::probe_lines` (`bash -lc`, so the tmux under the user's login answers); one `psmux.exe list-sessions -F '#S'` when any project is on Windows. Names back, matched against `session_names`, each path kept only on its own side (`distro_of` agrees). ⚠️ Two facts measured first: `tmux ls` with no server exits 1 with *error connecting to /tmp/tmux-1000/default* on **stderr**, and `probe_lines` ignores exit status but not stderr — hence the redirect; `psmux list-sessions` with no server prints nothing and exits 0 (probed: psmux 3.3.8, `exit=0 out=[]`). `psmux.exe` by name, chapter 28's lesson, though `Command` never sees a PowerShell alias anyway. A missing psmux is an empty list, never an error. No test-facing `index()` map and no `#[ignore]` live probe: nothing would call the first, and the Verify section is the second.

Four tests: the list script silences the no-server error; `parse_session_lines` trims and drops blanks; a stopped distro contributes nothing and is never probed (no distro is running, so `collect` returns for the WSL path before it would ever spawn `wsl.exe`); `session_names` round-trips the launcher's name.

> `✅SESSIONS: read the live tmux and psmux sessions` — `cargo test` **156**.

## 44.3 — The kill

`kill(project, running)`: the name from `session_names`, the target `=<name>` (exact, chapter 26's rule); a WSL project → `tmux kill-session -t '=…' 2>/dev/null` through `probe_lines`, **refused when the distro is stopped** (*is not running, there is no session to kill*); a Windows project → `psmux.exe kill-session -t =…`.

> `✅SESSIONS: kill a projects session`

## 44.4 — Two commands

`get_live_sessions(projects) -> Vec<String>` through `running_for` — the same liveness gate as the git pass — and `kill_session(project)`. Nothing is cached on `AppState`: the hook holds the set, and nothing else would read a copy.

> `✅CMD: live sessions and kill`

## 44.5 — The hook

`useProjects` gains `sessions: Set<string>`, loaded in `loadDetails` beside git and tech — with the badges, on the same focus cooldown, never more often — and `forgetSession(fullPath)` for the moment after a kill (a plain function — no `useCallback` under the compiler).

> `✅HOOK: sessions ride the badge pass`

## 44.6 — The chip

`RowMetaProps.live`, `ProjectTreeProps.sessions`; `RowMeta` shows **live** in the accent after the branch chip — a `size-[7px]` dot with a little of the glow (`shadow-[0_0_6px_var(--color-accent)]`) and the word — with the title *psmux session is running; a terminal launch reattaches* (or *tmux* on WSL). `rowProps` sets `live: sessions?.has(project.full_path)`; App passes `sessions` down.

> `✅UI: live chip on the row`

## 44.7 — The verb tells the truth

`App` keeps `tmuxOn`, read from `get_tmux_config` on mount and again when Settings closes (the tmux panel saves there). `selectedLive` = the selection has a live session. The footer's terminal group reads **Reattach** (`StatusBarProps.reattach`) and the context menu **Reattach terminal** only when `live && tmuxOn`. ⛔ With the multiplexer off a launch is a plain shell, so the verb stays *Terminal* even under a chip; a label that promised a reattach the script would not do would be a lie.

> `✅UI: reattach when the script will`

## 44.8 — Kill from the palette

*Session: kill for &lt;project&gt;* — disabled with *No live session for the selection* until there is one — → the confirm sheet → `kill_session` → `forgetSession` and a toast. `forgetSession` joins App's `useProjects` destructure here, its first caller (the intermediate `tsc` would have refused an unread name).

> `✅UI: kill the session from the palette`

## 44.9 — Verify

`cargo test` **156**, `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. Back up the six files. A psmux session made by hand with the launcher's own name — computed in Python from `sanitize_file_stem` + FNV-1a over the lowercased, forward-slashed path: `devgo-tutorials-16b05c66` for `G:\01_tauri\devgo-tutorials` — `psmux.exe new-session -d -s … -c …`; `list-sessions` shows it. Headless over CDP. The WSL distro stayed stopped.

**FIX 1, found first.** `get_live_sessions` over `invoke` answered `["G:\\01_tauri\\devgo-tutorials"]` — the read and the name both right — and no row wore the chip: `rowProps` set `live`, `ProjectRow` did not forward it to `RowMeta`, and a spread of an object with an extra key is not a type error. `ProjectRowProps.live` + the forward; HMR, and the chip appeared: *live* in `rgb(34, 211, 238)`, the dot `7 × 7`, the title *psmux session is running; a terminal launch reattaches*. → `✅FIX: the row forwards live to its meta`.

**The verb.** `get_tmux_config` → `enabled: false` (the setting on this machine): the row selected by its name cell, the footer reads *Edit · VS Code · Terminal · Windows Terminal*, the context menu *Open terminal*. `set_tmux_config` with `enabled: true`, Settings opened and closed so App re-reads: footer **Reattach**, menu **Reattach terminal**. (A first read said *Terminal* under the chip because the click had landed on the GitHub row of the same name — the repo card lists `devgo-tutorials` too; the project row is found by its `.group` class and clicked on its name cell.)

**The kill.** Palette, `kill` → *Session: kill for devgo-tutorials — The tmux / psmux session and every window in it*, Enter → the sheet, focus on Cancel. **FIX 2:** the sheet read *Stop WSL … Stop* — App's one `ConfirmDialog` carried the WSL title and verb itself. `confirmAction` gains optional `title` / `confirmLabel` (defaults keep the WSL ones); the kill sets *Kill session* / *Kill*. → `✅FIX: the kill sheet says kill`. Reopened: *Kill session · Kill the session for devgo-tutorials? Every window in it closes. · Cancel · Kill*; *Kill* clicked → the chip is gone, `psmux list-sessions` is empty, the footer reads *Terminal* again (the toast was not read: its selector did not match). The `__warm__` psmux server psmux leaves behind (chapter 28) stopped by hand. `set_tmux_config` back to `false`.

`Ctrl+Q`, restore the six files (all matched), the installed DevGo restarted.

> `✅STAGE: 44 live-sessions`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/launcher.rs   tmux_session_name pub(crate); session_names
  src/services/sessions.rs   TMUX_LIST, collect, psmux_sessions, parse_session_lines, kill; 4 tests
  src/commands.rs, lib.rs    get_live_sessions, kill_session
src/
  hooks/useProjects.ts       sessions, forgetSession
  components/ProjectTree.tsx the live chip; ProjectRow forwards live
  components/StatusBar.tsx   Reattach
  App.tsx                    tmuxOn, selectedLive; the menu label; session.kill; confirmAction title/verb
  types.d.ts                 RowMetaProps.live, ProjectRowProps.live, ProjectTreeProps.sessions, StatusBarProps.reattach
```

The launcher's biggest invisible advantage, made visible. Close everything and come back: the session is still there, and the row says so.

> **The thread running through this chapter.** Both fixes were the same shape: a value that existed and was not carried the last step — `live` stopped one component short of the chip, and the dialog's title stopped at the dialog. The read was right from the first `invoke`; the screen is what has to be checked.
