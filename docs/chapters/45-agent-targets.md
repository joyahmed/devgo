# 45 — The Agent Runs in a Real Terminal (post-plan)

**Branch:** `45.agent-targets` — `git checkout 45.agent-targets` gives you this chapter's finished app; `git diff 44.live-sessions 45.agent-targets` is exactly what this chapter adds.

**Starting from:** chapter 44 — the row says when a session is live. DevGo knows two kinds of target, editor and terminal, and the default session already opens an `agents` window that nothing ever puts an agent in.

**Goal:** Claude Code, Codex, OpenCode and Gemini CLI as launch targets — detected where they are installed, on Windows or inside a running distro — opening in your terminal, in the project directory, one key away.

> **Hold on to:**
> 1. **An agent is a command, not a program with a directory flag.** `executable` is the Windows command (empty when it lives only in a distro), `wsl_executable` the in-distro one; the terminal's run template — chapter 20's dev-script path — does the launching. No templates of its own.
> 2. **A third enum variant is a tour of every two-arm site.** Rust's `match` finds the two in `preferences.rs`; the rest — the store's last-of-a-kind rule, `get_default_targets`, the hook's filters, the manager's lists, the footer, the palette, the menu — you find by hand, and the footer must not grow an empty group.
> 3. **Detected only for the side it is on.** `where.exe` here, `command -v` under `bash -lc` in each *running* distro; a blocked side is a disabled button with a sentence, before the click.
>
> Rust: a `pub const` table of `(&str, &str)` pairs shared by two probes through one `present_in_distro(distro, table)`; `Option::filter` to turn an empty string into `None` on the way to `ok_or_else`. TypeScript: a conditional spread (`...(agents.length > 0 ? [group] : [])`) to keep a group out of a list.

> The plan said "a new `TargetKind::agent`", and the code said a third variant touches **eight** hard-coded two-arm sites. The one open question — a plain tab, or `send-keys` into the session's `agents` window — went to the plain tab; the `agents` window keeps its name for the day the setting arrives.

---

## 45.1 — A third kind

`TargetKind::Agent` (`snake_case` on the wire, so `"agent"` — a `targets.json` written by a newer build already carries rows with that word, and **the chapter 22 guard that has moved such a file to `.bak` on every dev launch since chapter 36 stops tripping here**: the agent targets simply load). `Preferences.default_agent` with `serde(default)`, the two `match` arms in `default_target` / `set_default_target`; `TargetStore::remove` lets the **last agent** go (zero agents is a valid machine; zero terminals is a button that can never do anything); `get_default_targets` iterates all three kinds.

> `✅TARGET: agent kind`

## 45.2 — Found where they live

`editors.rs`: `pub const AGENTS = [("claude", "Claude Code"), ("codex", "Codex"), ("opencode", "OpenCode"), ("gemini", "Gemini CLI")]`. `detect` asks `where_lookup` for the four names (an npm-installed CLI is `claude.cmd`; `where` lists it, the terminal's run template runs it) and builds a Windows-side agent target for each hit — `id` the command, `executable` the command, everything else empty. Per running distro, `present_in_distro(distro, AGENTS)` — `in_distro` generalised to take its table, `IN_DISTRO` passed for the editors — builds `<exe>-<distro>` targets with `executable` empty and `wsl_executable: Some(exe)`. One test: the four names are plain lowercase commands.

> `✅TARGET: agents found on both sides` — `cargo test` **157**.

## 45.3 — Open the agent in the terminal

`open_agent(project, target_id)`: `resolve_target(Agent)`, the command for the project's side (`wsl_executable` on WSL, `executable` on Windows, `filter(|c| !c.is_empty())`), refused with *`<name>` is not installed on the `<side>` side. Install it … and scan again in Settings* when the side has none; then `scripts::run(&project, &command, &terminal, &info)` — the very path *Run dev script…* uses — and `record_launch`. Registered.

> `✅CMD: open agent in the terminal`

## 45.4 — The registry and the key

`TargetKind` (TS) gains `'agent'`; `TargetRegistry.agents` and `useTargets` filters a third list; `useLaunchActions.openAgent(project?, targetId?)`; `ShortcutId` `'openAgent'` and the row in `shortcuts.ts` — `Ctrl+Alt+Enter`, *Open in agent*, Project group — declared once, read by the footer, the menu and the Settings table like every other key.

> `✅HOOK: agents in the registry and the key`

## 45.5 — Agents in the target manager

`TargetManagerProps.agents`; `lists` gains *Agents*; `KINDS` gains `'agent'` on the add form; the badges table is kind-aware — *windows only* / *wsl only* read templates that an agent never has, so they hide for agents and one badge says the side (*in distro* / *windows*); the command line under the name is `wsl_executable ?? executable` for an agent. The scan hint names the four CLIs and says where an agent opens. `Settings` passes `agents`.

> `✅UI: agents in the target manager`

## 45.6 — The footer group, absent until there is one

`LaunchKind` gains `'agent'` (the launch moment plays for it too); `StatusBarProps.agents` / `onAgent`; `TargetGroup`'s `blocked` becomes kind-aware — an agent is blocked on the side it does not exist on (`isWsl ? !wsl_executable : !executable`), with its own sentence; an editor or terminal stays blocked on WSL only without a WSL form. The `groups` table gains its third entry through a conditional spread — **the footer must not grow an empty group**. App: `handleOpenAgent` (flash + `openAgent`), the wiring, and the key fires only when `targets.agents.length > 0`.

> `✅UI: agent group in the footer`

## 45.7 — The menu and the palette

The context menu lists *Open in &lt;agent&gt;* per agent after *Open both*, the default carrying the key, each disabled for the wrong side; the palette `open.agent.<id>` — *Open in Claude Code — devgo-tutorials, in your terminal* — the same rule.

> `✅UI: agents in the menu and the palette` — `bun run build` clean.

## 45.8 — Verify

`cargo test` **157**, `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. Back up the six files. Headless over CDP; the distro stayed stopped. `where.exe claude codex opencode gemini` on this machine: `claude.exe` (WinGet links), `codex.exe`.

**The guard is quiet.** The dev build started on a `targets.json` that already held two agent rows — `claude` (`kind: agent`, Windows) and `claude-ubuntu-26-04` (in distro) — and made **no `targets.json.bak`**: the first dev launch since chapter 36 that did not.

**The footer.** *Edit · VS Code · Zed · Terminal · Windows Terminal · **Agent · Claude Code · Claude Code (Ubuntu-26.04)** · Open Both*; *Claude Code* is the default (`Ctrl+Alt+⏎`). `devgo-tutorials` (Windows) selected: *Claude Code* enabled, *(Ubuntu-26.04)* disabled; `shop` (WSL) selected: the reverse, the disabled one titled *Claude Code is not installed on this project's side*.

**The refusals, over `invoke`.** `open_agent` for a WSL project with `claude` → *Claude Code is not installed on the WSL side. Install it in the distro and scan again in Settings*; for a Windows project with `claude-ubuntu-26-04` → *… on the Windows side. Install it on Windows …*. (**FIX** found here: the second sentence started lowercase — `install it` → `Install it`; the dev build rebuilt Rust in 8 s and the sentence re-read. → `✅FIX: the refusal starts its sentence`.)

**Settings › Editors & Terminals.** Headings *Editors · Terminals · Agents · Detected on this machine*; the Agents rows *Claude Code · default · windows · claude* and *Claude Code (Ubuntu-26.04) · in distro · claude*. *Scan* → *VS Code Insiders* and **Codex — agent · codex**; not added (the file is restored by hash anyway).

**Palette and menu.** `claude` in the palette → *Open in Claude Code — devgo-tutorials, in your terminal* and *Open in Claude Code (Ubuntu-26.04)*; the row's menu reads *Open in editor · Open terminal · Open both · **Open in Claude Code Ctrl+Alt+⏎ · Open in Claude Code (Ubuntu-26.04)** · Reveal in Explorer …*.

**The launch.** `devgo-tutorials` selected, `Ctrl+Alt+Enter`: a `claude` process and an `OpenConsole` started within five seconds (Windows Terminal reused the open window, so a new tab, not a new process); both stopped, nothing left. The launch flash was not caught (read 300 ms after a 220 ms animation).

`Ctrl+Q`, restore the six files (all matched), the installed DevGo restarted.

> `✅STAGE: 45 agent-targets`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/models/target.rs           TargetKind::Agent
  src/services/preferences.rs    default_agent; the two arms
  src/services/target_store.rs   the last agent may go
  src/services/editors.rs        AGENTS; Windows-side and in-distro agent targets; present_in_distro(table)
  src/commands.rs, lib.rs        open_agent; get_default_targets over three kinds
src/
  types.d.ts                     TargetKind | 'agent'; ShortcutId 'openAgent'; LaunchKind 'agent'; TargetRegistry/TargetManagerProps/StatusBarProps.agents, onAgent
  shortcuts.ts                   Ctrl+Alt+Enter
  hooks/useTargets.ts            agents
  hooks/useLaunchActions.ts      openAgent
  components/TargetManager.tsx   the Agents list, the side badge, the third add-form kind
  components/StatusBar.tsx       kind-aware blocked; the Agent group, only when there is one
  components/Settings.tsx        agents through
  App.tsx                        handleOpenAgent; the key; the menu and palette entries
```

The agent gets your terminal — its clipboard, its scrollback, its focus — not a webview's. Detected where it is, offered only for the side it is on. Eight sites, one kind; the footer stays empty until there is something to show.

> **The thread running through this chapter.** With a hand-styled button at each site, adding a kind is eight button edits; here it is tables — `lists`, `KINDS`, `groups`, `badges` — and the one `Button`. The count of sites is the same; what differs is that each site is a row in a list, and a row is hard to forget.
