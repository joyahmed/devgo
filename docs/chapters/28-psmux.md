# 28 — The Same Session on Both Sides (post-plan)

**Branch:** `28.psmux` — `git checkout 28.psmux` gives you this chapter's finished app; `git diff 27.perf 28.psmux` is exactly what this chapter adds.

**Starting from:** chapter 27 — a WSL project's terminal opens a tmux session with the windows you named in Settings, reconciled on every launch, or a plain login shell if you switched the multiplexer off; and coming back to DevGo after a launch no longer costs a rescan. A Windows project's terminal opens `wt -d "{path}"`: one bare tab. The two halves of the machine get different apps.

**Goal:** give a Windows project the same named windows, from the same setting, through the same seam — and prove it against the real binary before a line of it is trusted.

> **Hold on to:**
> 1. **Answer the fork before you design around it.** *Is `psmux` a tool that exists, or something DevGo has to build?* Everything downstream turns on it. One probe session answers it, and the answer makes the chapter a translation instead of a feature.
> 2. **Probe the claims you are about to lean on — the probe can disagree with the README in either direction.** "Speaks tmux's command language" is a sentence; five commands are facts. One of them said the `=` prefix does nothing on this psmux. It stays anyway, and §28.1 says why.
> 3. **A translation is not a port.** `-cnotcontains`, `@(…)`, `-LiteralPath`, `return` — each one is the same invariant as the bash, said the way the second shell needs it said, and each one is a test.
> 4. **A headless run proves the script and hides the machine.** The generated file ran clean under `pwsh -NoProfile` five times. The first real launch, in the user's own shell with the user's own profile, opened a folder-picker dialog. The fix is §28.8 and it is one word.
>
> Rust: a `pub const &str` shared by three modules so they cannot drift; `let … else`; `fs::copy` *before* the write so a failure between the two leaves the file it found; a new arm on a `match` over a tuple; `lines().flat_map(|l| l.match_indices(..))` to walk every mention of a word. TypeScript: nothing new.

> The plan for this slice had one question written at the top in capitals, and the instruction under it was *do not start building until that is answered*. An hour of design on the wrong branch of that fork is an hour thrown away. So the chapter starts by answering it.

---

## 28.1 — Is it a tool, or a feature?

`psmux` exists. [github.com/psmux/psmux](https://github.com/psmux/psmux) is a terminal multiplexer for Windows written in Rust: it drives ConPTY directly, speaks tmux's command language, reads your `.tmux.conf`, and one line puts it on a machine:

```powershell
winget install marlocarlo.psmux
```

If it exists, a Windows project's terminal is a launch target with a script — exactly what tmux already is, and chapter 26 is the design. If not, it is Windows Terminal tabs and panes driven by `wt` arguments — a different feature wearing the same name. So the first thing to do is not read the README; it is to run, from a shell, the five behaviours the chapter 26 script leans on, with the binary that will actually run them:

```powershell
psmux has-session -t '=devgo-probe'; $LASTEXITCODE       # 1, absent
psmux new-session -d -s 'devgo-probe' -n 'code' -c 'G:\01_tauri'
psmux has-session -t '=devgo-probe'; $LASTEXITCODE       # 0, present
psmux has-session -t 'devgo-pro';    $LASTEXITCODE       # 1
psmux list-windows -t '=devgo-probe' -F '#W'             # code
psmux new-window -t '=devgo-probe:' -n 'agents' -c 'G:\01_tauri'
psmux list-windows -t '=devgo-probe' -F '#W'             # code / agents
psmux kill-session -t 'devgo-probe'
psmux kill-server
```

Every answer is tmux's answer — with one exception worth being precise about. Line four asks whether a *prefix* matches, and it does not: `psmux 3.3.8 (66cf613)` matches a bare session name exactly and a prefix not at all, so the `=` that chapter 26 spent a section on is inert here today. It stays in the script regardless. tmux's own rule *is* prefix match, psmux tracks tmux release for release, and a version that adopts the rule would attach you to somebody else's project without a word. A cheap character now against a silent bug later is not a trade.

Two more things the probe shows that the README does not. `kill-session` on the last session does not end the server: psmux keeps a `__warm__` server with pre-warmed `pwsh` panes behind it, so a probe that stops at `kill-session` has left a process on the machine — hence the `kill-server`. And the version line says `tmux 3.3.8` before it says `psmux 3.3.8`: it installs `tmux.exe` beside itself as an alias, which is a thing to know before you assume `tmux` on PATH means WSL.

That is the design decision. psmux is a launch target with a script, and the rest of this chapter is chapter 26 again with the shells swapped.

## 28.2 — The twin, line for line where the shells allow it

`build_psmux_script` is `build_tmux_script` translated, and it sits directly under it in `launcher.rs`. The rules are not re-argued in comments that point back at the bash; they are repeated, because the next person to edit one script will not have the other open. Read the bash version once more, then this:

```rust
fn build_psmux_script(
    session: &str,
    windows_path: &str,
    tmux: &TmuxConfig,
) -> String {
    // -LiteralPath, not -Path: -Path reads [ and ] as wildcards, and
    // api[v2] is a legal directory that then "cannot be found". first in
    // both branches, so a detach leaves the -NoExit shell in the project
    let path_q = ps_quote(windows_path);
    let cd = format!("Set-Location -LiteralPath {path_q}\n");

    // off is no psmux, not psmux with one window: an empty list still
    // starts a server and leaves a session behind. the template's -NoExit
    // is what keeps this shell open
    if !tmux.enabled {
        return cd;
    }

    let windows = &tmux.window_names;
    let session_q = ps_quote(session);
    let exact_q = ps_quote(&format!("={session}"));
    let target_q = ps_quote(&format!("={session}:"));

    let create = match windows.first() {
        Some(first) => format!(
            "    psmux.exe new-session -d -s {session_q} -n {} -c {path_q}\n",
            ps_quote(first)
        ),
        None => {
            format!("    psmux.exe new-session -d -s {session_q} -c {path_q}\n")
        }
    };

    // -cnotcontains: the plain -notcontains is case-insensitive, so a
    // hand-made Code satisfies the check for code and the window you
    // configured never appears. whole-element too, so git cannot match a
    // git-log. @( ) so one window is still an array and none is an empty
    // one, not $null, which -cnotcontains would read as a list of one
    let reconcile: String = windows
        .iter()
        .map(|name| {
            let name_q = ps_quote(name);
            format!(
                "if (@(psmux.exe list-windows -t {exact_q} -F '#W' 2>$null) -cnotcontains {name_q}) {{\n    psmux.exe new-window -t {target_q} -n {name_q} -c {path_q}\n}}\n"
            )
        })
        .collect();

    // has-session answers with its exit code, and 1 is the answer we are
    // asking for; a profile that turns the native preference on under
    // ErrorActionPreference Stop would abort the script on it
    format!(
        r#"{cd}$PSNativeCommandUseErrorActionPreference = $false
psmux.exe has-session -t {exact_q} 2>$null
if ($LASTEXITCODE -ne 0) {{
{create}}}
{reconcile}psmux.exe attach -t {exact_q}
"#
    )
}
```

(The `psmux.exe` spelling arrives in §28.8; the commit at the end of this section says `psmux`. Type whichever you like — the test in §28.8 will tell you when it matters.)

Everything chapter 26 argued for is here: reconcile per window instead of one existence check, a block for the first name too, `=` on every target except the `-s` that names something not yet existing, nothing that kills, renames or prunes. What is new is what PowerShell makes you say differently, and each one is the bash invariant in a different costume:

- **`-cnotcontains`, not `-notcontains`.** PowerShell's comparison operators are case-insensitive unless told otherwise. With the plain form a hand-made `Code` window satisfies the check for `code`, and the window you configured is the one that never appears — the frozen-layout bug from 26.2, back through one missing letter. It is also a whole-element comparison, so `git` cannot match a `git-log` window the way an unanchored grep would; it is the `grep -Fx` of this script.
- **`@(...)` around the listing.** One window comes back as a string, no windows as `$null`, and `-cnotcontains` would read either as a list of one. The array wrapper makes both what they are.
- **`Set-Location -LiteralPath`, not `-Path`.** `-Path` reads `[` and `]` as wildcards, so a project called `api[v2]` — legal on Windows — fails with *cannot find path* on a directory that is right there, and the tab opens wherever pwsh happened to start. It is the bash script's `back$up` again: the path has to reach the shell exactly as it is on disk.
- **`$PSNativeCommandUseErrorActionPreference = $false`.** `has-session` answers with its exit code, and 1 is the answer we are asking for. A profile that turns the preference on and sets `$ErrorActionPreference = 'Stop'` would make that answer abort the script before `new-session` ever runs.
- **Off is one line.** `Set-Location` and nothing else — with `-NoExit` on the template (§28.5) that is a shell sitting in the project. The 26.5 argument holds unchanged: someone who does not want a multiplexer does not want a tidier one.

And `ps_quote` is `sh_quote` for the same reason. A window name is a string somebody else wrote — typed into Settings, or read out of a JSON file by `import_config_from_file`. Inside double quotes PowerShell expands `$var` and `$(…)`, and a `"` in the name closes the string so the rest of the line runs as commands: `a"; psmux kill-server; #` is a working way to end every session on the machine, which is exactly what the no-pruning rule forbids. Single quotes are PowerShell's literal string, and the one character needing care is `'` itself, which PowerShell escapes by doubling:

```rust
fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
```

Note what it does *not* do: bash's `'\''` close-escape-reopen would, in PowerShell, end the string and leave a stray backslash on the line. And a backslash needs nothing done to it, because PowerShell's escape character is the backtick, so `G:\dev` is `G:\dev` inside single quotes.

Ten tests, each the Windows twin of a tmux test above it — a rule that holds for one script and silently not the other is the asymmetry this chapter exists to remove. The default list in order with the first name on `new-session`; a custom list of four producing four reconcile blocks and no `code`/`agents`/`git`; an empty list opening one unnamed window; `=` on every `-t` and never on `-s` (the count of `" -t "` equals the count of `" -t '="`); no destructive verb anywhere; the reconcile blocks *after* the guard's closing brace; `-cnotcontains` on every name and `if (@(psmux…` exactly as many times as there are names; the hostile-name test with `a"; psmux kill-server; #`, `$(Remove-Item -Recurse G:\)` and `it's`, counting that every `"` left in the script is one the *name* contained and that `'it''s'` appears and `'\''` does not; `api[v2]` reaching both branches literally; and off producing exactly `Set-Location -LiteralPath 'G:\dev\api'\n`.

> `✅LAUNCH: psmux script for a windows project` — **110** tests. (`build_psmux_script` and `ps_quote` are dead code for two commits; the caller arrives in §28.4.)

## 28.3 — Not installed is not an error

psmux is one `winget install` away and most machines will not have it. The script must not error out on those — it must leave the same plain tab the user had before, in the project, with one line saying how to get the windows. So between the `Set-Location` and the first psmux call:

```powershell
if (-not (Get-Command psmux -ErrorAction SilentlyContinue)) {
    Write-Host 'DevGo: psmux is not installed, so this is a plain shell. For named windows: winget install marlocarlo.psmux'
    return
}
```

`return`, not `exit`. `exit` ends pwsh regardless of `-NoExit`, which closes the tab on the one machine where the message matters; `return` at script scope ends the script and nothing else, and the user is left where they were before this chapter existed. The test pins the order (`Set-Location` before the check, the check before `has-session`), the install command, `    return\n` inside the bail, and that the bail contains none of `exit`, `throw`, `Write-Error`.

> `✅LAUNCH: missing psmux is a plain shell, not an error` — **111** tests.

## 28.4 — The seam was already there

Chapter 26 moved the script gate off `TargetKind` and onto the resolved template: a script is written when the arguments that will actually run contain `{script}`, and not otherwise. Read the match in `launch_target` and notice the arm nobody wrote:

```rust
    let args = match (&wsl, args.contains("{script}")) {
        (Some((distro, linux_path)), true) => {
            let script = write_tmux_script(project, distro, linux_path, tmux)?;
            args.replace("{script}", &script)
        }
        _ => args,
    };
```

`(None, true)` — a Windows project whose template asks for a script — fell into `_ => args`, so the placeholder would have reached `cmd` verbatim. It never did, because the Windows template never asked. The whole feature is that arm:

```rust
        (None, true) => {
            let script = write_psmux_script(project, tmux)?;
            args.replace("{script}", &script)
        }
```

`write_psmux_script` is `write_tmux_script` with one thing removed. Same session name from `tmux_session_name` — the sanitised project name plus the FNV suffix of the lowercased path, so two projects called `api` still get two sessions. Same filename discipline, `devgo-{session}.ps1`, so two projects called `api` still get two files. The thing removed is the path conversion: the shell that reads this script is the one that wrote it, so the Windows path comes back as-is. (`std::fs::write` writes UTF-8 without a BOM, which matters in §28.5.) The doc comment on `TmuxConfig` in `preferences.rs` changes in the same commit — it is now *the windows a terminal launch opens: tmux inside the distro for a WSL project, psmux for a Windows one* — and says why there is no `PsmuxConfig` beside it: nobody wants `code`/`agents`/`git` on one half of the machine and something else on the other, and two lists drift. The struct keeps its name because that is what every `prefs.json` already calls it.

Two tests, twins of the chapter 26 pair: the placeholder is substituted for a Windows project (a `cmd /c echo {script} > marker` target — the file on disk is the psmux script with `Set-Location -LiteralPath 'G:\work\placeholder'` unconverted, and what `cmd` echoed is a `.ps1` path with no `/mnt/` in it), and a Windows template *without* the placeholder writes no file — the `_` arm was what made that true by accident, and now that the arm above it is real it has to stay true on purpose.

> `✅LAUNCH: windows projects write the psmux script` — **113** tests.

## 28.5 — The template that asks for it

The template goes on the `wt` target's Windows arguments, as a named constant in `models/target.rs`:

```rust
pub const WT_ARGS: &str =
    "-d \"{path}\" pwsh -NoExit -ExecutionPolicy Bypass -File \"{script}\"";
```

Three flags, each one a bug avoided. `-NoExit` because the script's last line is `attach`, and when that returns — you detached, or the session ended — the tab must stay open in the project rather than vanish. `-ExecutionPolicy Bypass` because a script in `%TEMP%` is precisely what a `RemoteSigned` machine refuses to run, and the refusal is a red line in a tab that then closes. And `pwsh`, not `powershell`: Windows PowerShell 5.1 reads a file without a BOM as ANSI, so a window name outside ASCII arrives garbled, fails the reconcile check, and is created again on every launch.

A `pub const` and not a literal in `defaults()`, because two other places have to agree with it byte for byte. `editors::detect`'s `wt` candidate takes `args: WT_ARGS` in the same commit — chapter 24's `detected_seeds_match_the_seeded_defaults` pins the candidate's templates to the seed's, so a commit that changed one without the other would not compile its own tests green — and `TargetStore` in the next section needs the old spelling too. One test in `target.rs`: the seeded terminal resolves a Windows path to `-d "G:\dev\app" pwsh -NoExit -ExecutionPolicy Bypass -File "{script}"` with the placeholder *left alone* (only the launcher can write the file), the WSL form still asks for one, and the run form — a command in a tab — is exactly what it was.

> `✅TARGET: wt asks for a session script on windows` — **114** tests.

## 28.6 — `defaults()` reaches nobody who already has the app

Change the `wt` template in `defaults()` and run the app: nothing happens. `TargetStore::new` reads `defaults()` only when there is no `targets.json`, and every machine this chapter was built for has one. Without more, a Windows project on the author's own install keeps opening one bare tab while a fresh install beside it opens three named windows, and nothing on screen explains the difference.

So the store migrates, narrowly, at the end of `new()`:

```rust
        let mut store = Self { targets, file_path };
        store.adopt_psmux_template()?;
        Ok(store)
    }

    /// defaults() is read once, on first run, so a changed wt template
    /// reaches nobody who already has the app, and that is every machine
    /// this was built for. Only a wt still carrying the old default is
    /// touched: a template the user edited is theirs, the same rule the
    /// session script follows for a hand-made window. The file is copied
    /// aside first, not renamed, so a failure between the two writes leaves
    /// the file it found rather than no file.
    fn adopt_psmux_template(&mut self) -> Result<(), AppError> {
        let Some(pos) = self
            .targets
            .iter()
            .position(|t| t.id == "wt" && t.args_template == WT_ARGS_PRE_PSMUX)
        else {
            return Ok(());
        };
        if self.file_path.exists() {
            let backup = format!("{}.pre-psmux", self.file_path.display());
            fs::copy(&self.file_path, backup)?;
        }
        self.targets[pos].args_template = WT_ARGS.to_string();
        self.save()
    }
```

with `pub const WT_ARGS_PRE_PSMUX: &str = "-d \"{path}\"";` beside `WT_ARGS` — typed here, in the commit that reads it. Only a `wt` whose template is byte-for-byte the old default is touched. A template the user edited to `-d "{path}" -p "Dev"` is theirs; rewriting it would throw away a choice to "fix" something they never asked about, the same rule the session script follows for a hand-made window. The original file is *copied* aside first, not renamed, so a failure between the two writes leaves the file it found rather than no file.

Three tests, each starting from a hand-written `targets.json` in the shape every install before this chapter wrote (the helper `pre_psmux_json(wt_args)` takes the one field that varies): an old file is rewritten, the rewrite is persisted (a second `new()` sees it without migrating again), every other field on `wt` survives, the backup is the original byte for byte and there is **no** `.bak` beside it — this is a migration, not a parse failure; a customised template is left alone, nothing is backed up, and the file is not rewritten; a fresh install carries the new template and gets no `.pre-psmux` of a file seeded a millisecond ago.

> `✅TARGET: old installs adopt the psmux template` — **117** tests.

## 28.7 — One setting, not two

The panel already exists; it just says the wrong thing. In `Settings.tsx` the heading becomes *Use tmux / psmux*, the paragraph under it says a launch opens a session on both sides and off means no multiplexer on either, a second paragraph names the install command in a `<code>` and says what happens without it, the on-button reads *Session* instead of *tmux session*, the tab in the registry reads *tmux / psmux*, and the `TmuxConfig` comment in `types.d.ts` follows the Rust one. The *Windows* list and its text are untouched — chapter 26 already wrote them without the word WSL.

> `✅UI: tmux panel names psmux`

## 28.8 — Verify, and the bug the headless run could not see

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **117** — chapter 27's 100 plus one for the target, three for the store and thirteen for the launcher. Then, in this order:

**Headless, against the binary.** Unit tests prove the script *says* the right things; they cannot prove psmux *does* the right things with what it says, and the probe in §28.1 was done by hand, not with the generated file. So generate one — a throwaway test calling `build_psmux_script("devgo-verify-a1b2c3d4", r"G:\01_tauri", …)` with `code`, `agents`, `git`, `it's`, `-log` and writing it to `%TEMP%` does it — strip the `attach` line into a copy so it does not take over the shell, and run the copy:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\devgo-verify-noattach.ps1
psmux list-windows -t '=devgo-verify-a1b2c3d4' -F '#W'
# code / agents / git / it's / -log
pwsh -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\devgo-verify-noattach.ps1
# second run: same five, nothing added, nothing printed
psmux new-window -t '=devgo-verify-a1b2c3d4:' -n 'mine' -c 'G:\'
pwsh -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\devgo-verify-noattach.ps1
psmux list-windows -t '=devgo-verify-a1b2c3d4' -F '#W'
# code / agents / git / it's / -log / mine — the hand-made one survives
psmux kill-server
```

Five windows in the configured order including one named `it's` and one named `-log`, a second run that reconciles nothing, a window made by hand still there after a third, and — `Get-Process pwsh, WindowsTerminal | Where MainWindowHandle -ne 0` — nothing on anyone's screen. Then `kill-server`, because of the warm pool.

**Migration, live.** With the four config files backed up (five here — an installed DevGo built past this chapter already has a `targets.json.pre-psmux`, and the run below overwrites it), write a `targets.json` in the pre-chapter shape — the `pre_psmux_json` helper's text, with `-d "{path}"` on `wt` — and `bun tauri dev`. Before the window is up, `targets.json.pre-psmux` exists with the hash of the file you wrote, `wt` in `targets.json` carries the `pwsh -NoExit …` template, and the old `.bak` has yesterday's timestamp: the file parsed, so chapter 22's guard never ran.

**The panel.** Settings → *tmux / psmux*: the heading, both paragraphs, *Session* / *Plain shell* with `aria-current` on whichever `prefs.json` holds. Choose *Session*, *Save*: `tmux_config.enabled` is `true`.

**The launch — and the bug.** `open_terminal` on a Windows project. A tab opens in Windows Terminal, runs the user's profile, and then does nothing: no *not installed* line, no psmux status bar, no prompt, no child process. Read the tab through UIA (`TermControl` supports `TextPattern`) and there is nothing after the profile's last line; enumerate the top-level windows of the tab's `pwsh` and there is one, class `#32770`, titled *No child projects found. Select a project folder directly.* — a `FolderBrowserDialog`.

The PowerShell profile on this machine does `Set-Alias psmux C:\Users\<you>\my-cli\psmux.ps1`, a project picker that predates this chapter. In the tab, `Get-Command psmux` found the **alias** — an alias is a command, so the check said *installed* — and `psmux has-session -t …` ran the picker with those words as its arguments. Every one of the nine psmux calls would have opened a dialog in turn. The five headless runs never saw it because they were `-NoProfile`, and a DevGo launch cannot be: this is the user's terminal, and the profile is theirs.

The fix is to ask for the *program* and call the *program*. `Get-Command psmux.exe -CommandType Application` cannot be satisfied by an alias or a function, and `psmux.exe` as the command word skips alias and function resolution the way a bare `psmux` does not. Every call in the script becomes `psmux.exe …`; the test walks every mention of `psmux` on every line except the `Write-Host` and requires `psmux.exe ` — a test that fails on the script exactly as §28.2 wrote it.

> `✅FIX: the psmux script calls the binary, not the alias` — **118** tests.

Close the blocked tab's `pwsh` (it is the one the launch spawned) and its window through UIA, then launch again: the tab shows psmux's status bar — `[devgo-9030:code- 1:agents  2:git*` — with the prompt in the project; `psmux list-windows -t '=devgo-90323b10' -F '#I:#W'` prints `0:code`, `1:agents`, `2:git`. (You land on `git`, not `code`: `new-window` without `-d` selects the window it makes, in tmux and psmux alike, so the first name in the list is not the window you land in, on either side. Noted, not fixed here.) *Plain shell*, *Save*, launch again: the script is one `Set-Location` line, no `psmux` process exists, and the tab is a prompt in the project.

Close the windows the launches opened (`WindowPattern.Close()` on the `CASCADIA_HOSTING_WINDOW_CLASS` window that holds only your tab — never the `WindowsTerminal` process, it is the user's), `psmux kill-server`, quit the dev build, restore the five files and compare hashes.

One more commit, because a doc comment written before the probe was read said what tmux does and not what the probe showed: the `=` test's comment now records that psmux 3.3.8 matches a bare name exactly, and why the character stays.

> `✅LAUNCH: what the probe found about the exact prefix`; `✅STAGE: 28 psmux`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/launcher.rs        build_psmux_script, ps_quote, write_psmux_script, the (None, true) arm; 14 tests
  src/models/target.rs            WT_ARGS, WT_ARGS_PRE_PSMUX; defaults() uses the first; 1 test
  src/services/editors.rs         the wt candidate shares WT_ARGS
  src/services/target_store.rs    adopt_psmux_template on new(); 3 tests
  src/services/preferences.rs     TmuxConfig drives both sides (comment)
src/
  components/Settings.tsx         the panel says tmux / psmux, names the install
  types.d.ts                      TmuxConfig comment
```

A Windows project's terminal opens the same named-window session a WSL project's does, driven by the same setting, through the same `{script}` seam — and an install from before this chapter picks it up on next launch with its old file kept beside the new one.

> **The thread running through this chapter.** The fork was answered before anything was designed, and the answer made the feature one match arm and a template string — chapter 26's decision to gate on the resolved template paid for itself one chapter later. Then two probes disagreed with two texts: the binary said `=` does nothing here, and the user's shell said `psmux` means something else. **Verify against the real thing, in the real place** — and when the real place is somebody's desktop, close what you opened.
