# 68 — The README

**Branch:** `68.readme` — `git checkout 68.readme` gives you this chapter's finished repo; `git diff 67.chrome 68.readme` is one file, `README.md`.

**Starting from:** chapter 67 — the chrome.

**Goal:** `README.md` was still the Tauri template plus the Mac's one install line (`79ed1fc`). Replace it with the real one: what DevGo is, the four lanes, the launch targets, GitHub, Servers, Settings, the keyboard, install, platform notes, a short History. No screenshots yet (they come later); no LICENSE line (there is no LICENSE file, and this chapter does not add one).

> **Hold on to:**
> 1. **The README says only what the code does.** Every key in the table is a row of `src/shortcuts.ts`; every command named (`Clone into…`, `Add to group…`, `Run dev script…`, `New nginx site…`, *Copy tunnel command*, *Reveal in Explorer*) is a label in `App.tsx`, `HelpPanel.tsx` or `Settings.tsx`; every path and default (`DEFAULT_ROOTS`, `DEFAULT_SUMMON_HOTKEY`, `MAX_TRANSPARENCY`, `TEXT_STEPS`, the 1900 / 1400 queries) is read off a constant. The help panel (40) already said most of it in the app's own words; the README is that voice, longer.
> 2. **It is written in the first person plural, plain.** No marketing, no feature checklist, no essay clauses. Sections in the order a new reader needs them: what it is → what you see (lanes) → what a key does (targets) → the two remote lanes → settings → keys → install → the two platform rules → where it came from.
> 3. **History is 3–5 lines of facts, to be shaped later.** Tax Survey 2023, the PowerShell right-click layer, DevGo v1 in C# / WinForms (May 2026), this Tauri rewrite, the server scripts (July), the two meeting in September. Two lines that converged, not "scripts, then DevGo". Nothing about how the repo was built.

## 68.1 — The shape

Eight `✅DOCS:` commits, one section each, the last one the read-through:

| commit | section |
|---|---|
| `✅DOCS: readme, what devgo is` | title, two paragraphs, the `<!-- screenshots: docs/screenshots/{windows,mac} -->` marker, the stack line |
| `✅DOCS: readme, lanes and targets` | *The four lanes* (Windows / Mac / Linux, WSL, GitHub, Servers; the search boxes, pin, the three sorts) and *Launch targets* (detection table, templates, the three keys + *Open both*, tmux / psmux, *Run dev script…*) |
| `✅DOCS: readme, github and servers` | *GitHub* (catalogue, the `local` badge that follows the disk (65), clone, groups, branches, live search) and *Servers* (ssh config import, `tunnel` + *Copy tunnel command*, folders and `DEFAULT_ROOTS`, apps from `devgo-inventory.sh`, actions from `devgo-actions.json`, forms with `--dry-run`) |
| `✅DOCS: readme, settings` | the page list in Settings' order, Appearance (five themes, 0–60 transparency and the OS note, 85–150 text, hints), Shortcuts + summon, Config export / import, the app-data folder and `.bak`, ✕ hides / tray / `Ctrl+Q`, one instance |
| `✅DOCS: readme, keyboard` | the table, every row of `SHORTCUTS` plus the summon default, `Ctrl` → `Cmd` on a Mac |
| `✅DOCS: readme, install and platform notes` | Releases link (70 makes it real), the NSIS per-user install and SmartScreen, the dmg and Gatekeeper (the Mac's line, kept, `DevGo.app` after the brand commit), the optional tools, from source, *WSL never boots on launch*, *the Mac's PATH*, nothing blocking on the UI thread |
| `✅DOCS: readme, history` | `## History` |
| `✅DOCS: readme, read through` | the UNC prefix's second backslash (a shell heredoc ate it; put back in the editor), *this Windows machine* → *Windows*, History cut to one paragraph |

The screenshots marker is an HTML comment on its own line under the intro, so the section can be dropped in without moving anything. `docs/` does not exist in the repo and this chapter does not create it.

## 68.2 — Verify

- Every key in the README's table is in `src/shortcuts.ts`: a script that collects `keys: '…'` from the table and every backtick span from the README's *Keyboard* section (↑↓→← mapped to `Arrow*`) reports **in readme not in table: {Ctrl+Alt+Space}** (the summon default, `DEFAULT_SUMMON_HOTKEY` in `preferences.rs`) and **in table not in readme: {}**.
- Every command named exists: `Clone into…` (`App.tsx:712`), `Add to group…` (`App.tsx:727`), *Copy tunnel command* (52), `Run dev script…` / `Open remote in browser` (`shortcuts.ts`), *New nginx site…* / *Preview* (51, `HelpPanel.tsx`), `Export…` / `Import…` / `Reset cache` (`Settings.tsx`), `Show DevGo` / `Quit` (`tray.rs`), *Import from ~/.ssh/config* (`Settings.tsx:896`).
- Every constant matches: `WIDE_QUERY 1900` / `MID_QUERY 1400` (`rowStyles.ts`), `DEFAULT_ROOTS = ~, ~/projects, /var/www, /srv` (`server_folders.rs`), `MAX_TRANSPARENCY 60`, `TEXT_STEPS 0.85…1.5`, the five theme names (`themes.ts`), the Settings page order (`Settings.tsx:1029–1110`), the Windows and Mac candidate tables (`editors.rs`), the agents (`claude`, `codex`, `gemini`).
- The sweep: `grep -i 'private\|reference\|the book\|claude\|session\b\|\bAI\b\|tutorial'` over `README.md` hits only *Claude Code* as a launch target and *tmux session*.
- Gates unchanged: `tsc -b`, `bun run build` (`contrast ok: 6 palettes x 8 rules, 5 lane hues`), `cargo check` 0 warnings; `cargo test` 202 on Windows (nothing in Rust moved).
- `main` = `1710276 ✅STAGE: 68 readme`, 8 commits + STAGE, fast-forwarded and pushed with `68.readme`.
