# 59 — Nobody's Child, Fully

**Branch:** `59.clean-environment` — `git checkout 59.clean-environment` gives you this chapter's finished app; `git diff 58.workspace-reveal 59.clean-environment` is exactly what this chapter adds.

**Starting from:** chapter 58 — every item on a workspace header does what it says, and the key does too.

**Goal:** a terminal opened from DevGo came up with every line white — no prompt colours, no `ls` colours, nothing. Nothing in DevGo that touches a terminal had changed. What had changed was *who started DevGo*: it had been installed and launched from a coding agent's tool shell, and that shell carries an environment built for machine-readable output. Chapter 53 scrubbed one family of those variables (the session markers); this chapter scrubs the other (the tool shell's conveniences) and pins the whole scrub with a test that never spawns.

> **Hold on to:**
> 1. **Two shapes for two kinds of variable.** Markers are matched by **prefix** against the live environment, because agents add markers faster than a list can follow. Conveniences are a **fixed list applied unconditionally** — `env_remove` on a name that is not set is a no-op, so there is nothing to check first, and the list *is* the documentation of what a tool shell does to its children.
> 2. **⛔ Never `env_clear()`.** A clean slate drops `PATH`, `HOME`, `USERPROFILE`, `WT_SESSION` and everything the user's profile set — the terminal opens and nothing in it works. The scrub removes what an agent added; it never decides what a person may keep. The test's `PATH` line exists to fail the day someone reaches for it.
> 3. **`Command::get_envs()` shows a removal as `(name, None)`.** A scrub is observable on the builder, before any process exists — the second test shape beside 53's dump-and-read.
>
> Rust: `&[&str]` for a list of names that never changes; `for name in AGENT_SHELL_VARS { cmd.env_remove(name) }` — `env_remove` takes `AsRef<OsStr>`, so `&&str` is fine.

**Shape of the chapter.** 53 already did the marker half — `spawn_raw` strips `CLAUDE_CODE_*`, `CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `AI_AGENT`, with a test that launches a `cmd` target whose template is `/c set > "marker"` and fails without the scrub. That loop was inline in `spawn_raw`. What 59 adds beyond it, and what is typed: the loop becomes `scrub_agent_env(&mut Command)`, the list `AGENT_SHELL_VARS` and its second loop go into it, and the `get_envs` test lands beside 53's. `spawn_raw` builds `Command::new("cmd")` + `quiet().shell_line(…)` inline (54), so the call is one line after that.

---

## 59.1 — The variables an agent's shell carries

What such a shell sets (read with `Get-ChildItem env:` from inside one, filtered to the names below; the values are illustrative):

```
AI_AGENT=claude-code_…_agent   CLAUDECODE=1   CLAUDE_PID=…
CLAUDE_CODE_CHILD_SESSION=1  CLAUDE_CODE_ENTRYPOINT=cli  CLAUDE_CODE_SESSION_ID=…  CLAUDE_CODE_MESSAGING_*=…
NO_COLOR=1
GIT_EDITOR=true  GIT_ASKPASS=  GIT_TERMINAL_PROMPT=0  GCM_INTERACTIVE=never
PROMPT=$P$G  DISABLE_AUTOUPDATER=1  NoDefaultCurrentDirectoryInExePath=1
```

The first two lines are what 53 strips. The rest is the tool shell's *conveniences* — set so a command run by the agent never colours its output, never opens an editor, never prompts for a password. Sensible for a tool; poison for a terminal a person is about to type into:

- `NO_COLOR=1` — starship, pwsh's `$PSStyle`, `ls`, `git`: every one of them honours it. The whole terminal is white. This is the one you see.
- `GIT_EDITOR=true` — `git commit` runs `true` as its editor and commits whatever message it already has, which is none. This is the one you would not see until the log was full of empty subjects.
- `GIT_TERMINAL_PROMPT=0` / `GCM_INTERACTIVE=never` — a push that needs credentials fails instead of asking.

A process inherits its parent's environment. DevGo started from that shell has all of it; `spawn_raw` starts every editor, terminal and agent from DevGo's environment; so they all have it too. Nothing in the build can see this — it depends on how the exe was launched, not on what it contains.

## 59.2 — Scrub the shell, not only the markers

First the marker loop leaves `spawn_raw` for a function of its own, unchanged in what it does — the call is one line after `shell_line`:

```rust
let mut cmd = Command::new("cmd");
cmd.quiet().shell_line(format!("/c {exe} {args}"));
scrub_agent_env(&mut cmd);
```

> `✅LAUNCHER: the scrub is a function`

Then the list and its loop:

```rust
// what an agent's tool shell sets so its own commands stay plain and
// never ask: no colours, no editor, no credential prompt. a terminal
// opened from a devgo started in that shell came up all white
const AGENT_SHELL_VARS: &[&str] = &[
    "NO_COLOR",
    "GIT_EDITOR",
    "GIT_ASKPASS",
    "GIT_TERMINAL_PROMPT",
    "GCM_INTERACTIVE",
    "PROMPT",
    "DISABLE_AUTOUPDATER",
    "NoDefaultCurrentDirectoryInExePath",
];

// a launcher is nobody's child. devgo started from inside a claude code
// session inherits that session's environment, and every editor, terminal
// and agent it opens inherits it too: a claude launched that way said
// its transcript saving was off, a terminal had no colours. scrub both so
// what devgo opens is a fresh top-level thing, whatever started devgo.
// the markers by prefix because their set grows; the list unconditionally,
// env_remove on a name that is not set is a no-op. never env_clear: that
// drops PATH and HOME with them
fn scrub_agent_env(cmd: &mut Command) {
    for (key, _) in std::env::vars_os() {
        let name = key.to_string_lossy();
        if name.starts_with("CLAUDE_CODE_")
            || ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "AI_AGENT"]
                .contains(&name.as_ref())
        {
            cmd.env_remove(&key);
        }
    }
    for name in AGENT_SHELL_VARS {
        cmd.env_remove(name);
    }
}
```

⚠️ The list is a judgement: a user who set `NO_COLOR=1` in their own profile on purpose will find DevGo's terminals coloured anyway. That user is imaginary; the one whose shell had it set for them is real.

> `✅LAUNCHER: scrub the agent shell conveniences`

## 59.3 — A test that does not spawn

```rust
#[test]
fn the_scrub_removes_the_agent_shells_conveniences_and_its_markers() {
    let mut cmd = Command::new("cmd");
    scrub_agent_env(&mut cmd);
    let removed: Vec<String> = cmd
        .get_envs()
        .filter(|(_, v)| v.is_none())
        .map(|(k, _)| k.to_string_lossy().into_owned())
        .collect();
    for name in ["NO_COLOR", "GIT_EDITOR", "GIT_TERMINAL_PROMPT", "PROMPT"]
    {
        assert!(removed.iter().any(|r| r == name), "{name}: {removed:?}");
    }
    assert!(!removed.iter().any(|r| r == "PATH"), "{removed:?}");
}
```

53's test (`a_launched_target_inherits_no_claude_code_markers`) still runs beside it and still launches a real `cmd` — the two shapes cover each other: one proves the builder, the other proves the child.

> `✅TEST: the scrub leaves path alone`

Two things to do the day this bites again, in this order: check `Get-CimInstance Win32_Process` for DevGo's parent — if it is not `explorer`, the environment is suspect — and relaunch it through Explorer (`explorer.exe path\to\devgo.exe`) before reading any code.

## 59.4 — Verify

`cargo test` **188** (187 + the `get_envs` test), `cargo check` 0 warnings. No dev build: the change is in what a spawned child inherits, and the two tests are the proof — a live one would open a Windows Terminal tab that cannot be closed without touching a terminal in use (the 53 rule). WSL running (not by us), left alone.

The diagnosis was applied before the chapter was typed: at the end of 58's run the installed DevGo had been relaunched from the tool shell that built it — parent `pwsh`, the sixteen variables above inherited. Stopped and relaunched with `explorer.exe 'C:\Users\<you>\AppData\Local\DevGo\devgo.exe'`: `Win32_Process` says parent **`explorer`** (the one-shot `explorer.exe` that exits after the hand-off). Parent alone is not proof — that transient process had the shell's environment — so the environment block itself was read (a 30-line `ctypes` script: `NtQueryInformationProcess` → PEB → `ProcessParameters.Environment`): the tool shell **81 variables, 16 of them the markers and conveniences above**; the installed DevGo **43 variables, 0 hits**. That is the launcher left on screen.

> `✅STAGE: 59 clean-environment`; ff-merge; push.

---

## What you built

```
src-tauri/src/services/launcher.rs   AGENT_SHELL_VARS; scrub_agent_env; the get_envs test
```

- **A scrub that covers the whole tool shell** — session markers by prefix, the agent's conveniences by list, `PATH` untouched.
- **The rule, complete:** *a launcher is nobody's child* now means colours, editors and prompts too, not only session identity.
- **A diagnosis you can run** — the parent process tells you whether the environment can be trusted before the code can.
