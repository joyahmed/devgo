# 57 — One Container's Null

**Branch:** `57.docker-null` — `git checkout 57.docker-null` gives you this chapter's finished app; `git diff 56.equal-lanes 57.docker-null` is exactly what this chapter adds.

**Starting from:** chapter 56 — one table, the command row wrapping under 12 rem, ↻ keeping the rows on screen.

**Goal:** two things a Windows day after a Mac port can find. One is a bug a `u64` invites: a single Docker container on the box takes the whole host's inventory down with `devgo-inventory.sh: invalid type: null, expected u64`. The other is the port's cost on the side it was not written on — clippy warnings for Mac-only code that is dead on Windows. **This build was never down** (stage 50 met the box's containers head-on and tolerated the nulls with `null_as_zero`), and the Mac-only items are 55's, typed later with their `allow` attributes in place. So this chapter is a *change of model* and a paragraph, not a fix: `Option<u64>` says what the script means, the container's name is read at last, and the tooltip stops printing `?`.

> **Hold on to:**
> 1. **`serde(default)` covers a missing key, not a `null` one.** A key an older script does not write → `default`. A key the script writes as `null` because it *does not have the value* → `Option`. They are different statements about the other end, and only the second one is true of a container's restart count.
> 2. **Model what the script emits, not what you would have emitted.** `null_as_zero` (chapter 50's) made the app run; it also made "not known" read as "zero restarts", which a tooltip would happily print. `None` prints nothing, which is what is known.
> 3. **`allow`, never `cfg`, on code the other platform needs** — 57.2's rule, recorded here for chapter 55, which carries it.
>
> TypeScript: `a ?? b ?? '?'` — a fallback chain reads the first name that exists; a container has a `docker` name where a pm2 app has a `pm2` one.

**Shape of the chapter.** The Windows day's three findings against this tree:

| Finding | This tree | Typed? |
|---|---|---|
| 57.1 `restarts: u64` + `memory_mb: u64` under `serde(default)` refuse a container's `null` and fail the host; `Option<u64>` for both, a new `docker: Option<String>`, the tooltip reads it, a test pins the JSON | never failed: 50's FIX put `null_as_zero` on both counters and a `docker` test asserting `restarts == 0`. But `0` is a claim the script did not make, and the `docker` name it did send was never read — the row's tooltip printed `? online` for every container. | **yes — the model, the name, the tooltip (57.1 below)** |
| 57.2 `#[cfg_attr(windows, allow(dead_code))]` on `login_path`, `with_login_path`, the Windows `resolve`, `MAC_TERMINAL_ARGS` / `MAC_TERMINAL_RUN_ARGS`; `allow(unused_imports)` on the `pub use` | none of those items exist on this branch — `login_path.rs`, the Mac constants and the `pub use` are 55's, typed later on a Mac with the six attributes in place (three in `login_path.rs`, one on the `pub use` in `platform/mod.rs`, two on the constants in `target.rs`). `cargo check` is at 0 warnings here without them. | no — typed with 55 |
| 57.3 the Windows run of the Mac port (a checklist of 55/56 claims) | no Mac port on this branch to run; 56 was typed and verified on Windows, and 55's Windows half is checked when it lands after 65. | no — nothing to run |

---

## 57.1 — `null` is not a missing key

The box's inventory, read before typing (`ssh box '~/scripts/devgo-inventory.sh'`): 26 apps, host `23/23 pm2 · 22 sites`, and under one app — call it `shop` — three processes the script's Docker branch wrote:

```json
{"pm2": null, "docker": "shop-web",      "status": "online", "restarts": null, "memory_mb": null, "ports": [3005]}
{"pm2": null, "docker": "shop-api",      "status": "online", "restarts": null, "memory_mb": null, "ports": [3004]}
{"pm2": null, "docker": "shop-postgres", "status": "online", "restarts": null, "memory_mb": null, "ports": [5433]}
```

A container has no pm2 restart count and no monit memory, so the script writes what it knows: `null`. `Process` since 50:

```rust
// a docker-run process reports null here; null is nothing to count
#[serde(default, deserialize_with = "null_as_zero")]
pub restarts: u64,
```

It parsed. It also turned "not known" into `0`, and the wire carried `restarts: 0, memory_mb: 0` to a frontend that cannot tell a container from a pm2 app that has never restarted. The model says what the script means instead:

```rust
pub struct Process {
    #[serde(default)]
    pub pm2: Option<String>,
    // the container name when the process is a docker container; then
    // pm2 is null
    #[serde(default)]
    pub docker: Option<String>,
    …
    // a container has no pm2 restart count and no monit memory, so the
    // script writes null. option, not a default: null means not known,
    // not zero
    #[serde(default)]
    pub restarts: Option<u64>,
    …
    #[serde(default)]
    pub memory_mb: Option<u64>,
}
```

`null_as_zero` goes (nothing else called it). `docker` is new to the model but not to the wire: the script had been sending the container name all along and nothing read it. Nothing in Rust reads `restarts` or `memory_mb` but the tests, so the type change compiles on its own.

> `✅SERVERS: null counters are options`

The 50 test asserted `restarts == 0` on a trimmed container; it becomes a test on the exact process the box emits (`pm2`, `pid`, `restarts`, `uptime`, `node`, `memory_mb` all `null`). ⚠️ The names below are placeholders: the fixture at this stage carried the box's real app name, and chapter 69 generalises the fixtures.

```rust
#[test]
fn a_docker_container_with_null_counters_parses() {
    let text = r#"{"apps":[{"name":"shop","dir":"/var/www/shop","processes":[{"pm2": null, "docker": "shop", "pid": null, "status": "online", "restarts": null, "uptime": null, "cwd": "/var/www/shop", "node": null, "ports": [3005], "memory_mb": null}]}]}"#;
    let inv = parse_inventory(text).unwrap();
    let p = &inv.apps[0].processes[0];
    assert_eq!(p.docker.as_deref(), Some("shop"));
    assert_eq!(p.pm2, None);
    assert_eq!(p.restarts, None);
    assert_eq!(p.memory_mb, None);
    assert_eq!(p.ports, vec![3005]);
}
```

`cargo test` **187**.

> `✅TEST: a docker container parses`

`types.d.ts` mirrors the three fields on `ServerApp.processes[]` — `docker: string | null`, `restarts: number | null`, `memory_mb: number | null`. `tsc -b` is clean: the one reader is `p.restarts ? … : ''`, and `null` is as falsy as `0` was.

> `✅TYPES: docker name on a process`

`ServersLane.tsx`, `appTitle` — the tooltip on a folder row that is an app, one line per process:

```ts
`${p.pm2 ?? p.docker ?? '?'} ${p.status ?? ''}${p.restarts ? ` · ${p.restarts} restarts` : ''}`
```

A container has no `pm2` name, so its `docker` name stands in; `?` is what is left for a process that has neither.

> `✅UI: container name in the app tooltip`

## 57.2 — Dead on Windows, on purpose (nothing to type)

The six warnings a Mac port leaves on Windows are all 55's items — `login_path`, `with_login_path`, the Windows arm of `resolve`, `MAC_TERMINAL_ARGS`, `MAC_TERMINAL_RUN_ARGS`, and the `pub use` in `platform/mod.rs` — every caller of which is `cfg(not(windows))`. The rule: `#[cfg_attr(windows, allow(dead_code))]` on the items and `#[cfg_attr(windows, allow(unused_imports))]` on the `pub use`, the mirror of 54's `#[cfg_attr(not(windows), allow(dead_code))]` on `shell_line` — ⛔ never `#[cfg(not(windows))]`, which would stop the Mac code compiling on the machine most of the work happens on. Chapter 55 types the attributes with the items (its 55.3 and 55.4 name each one), so `cargo check` is at 0 warnings on Windows the day it lands. Here, on this branch: no items, no warnings, nothing typed.

## 57.3 — Verify

`cargo test` **187** (186 + the container test; the 50 assertion it replaces was inside an existing test), `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. Fourteen files backed up by hash; the installed DevGo stopped for the run; WSL running (not by us), left alone.

Live over CDP, the real box: `list_server_folders('box')` in 1585 ms → `inventory_error: null`, **26 apps**, host `23/23`, and the three `shop` processes on the wire as `pm2: null, docker: "shop-web" | "shop-api" | "shop-postgres", restarts: null, memory_mb: null` — `null` through to the frontend, not `0`. Then ↻ on the `box` row (*Reached just now · 150 folders*), the card expanded, `/var/www` open: the `shop` row's `title` reads

```
shop-web online
shop-api online
shop-postgres online
site shop · https
main @ abc1234 …
/var/www/shop
```

and no `title` on the page contains `? online`. The pm2 rows are untouched: `blog-web online · 1 restarts / blog-api online · 1 restarts`.

The dev build ran on through chapter 58 (React only there, Vite HMR); stopped after it, all fourteen files restored and hash-matched (0 mismatches of 14), the installed DevGo relaunched — through `explorer.exe`, so its parent is Explorer and its environment is the desktop's, not the shell that built it (chapter 59's diagnosis, applied one chapter early).

> `✅STAGE: 57 docker-null`; ff-merge; push.

---

## What you built

```
src-tauri/src/services/server_apps.rs   Process.docker; restarts/memory_mb Option<u64>; null_as_zero gone; the container test
src/types.d.ts                          the three fields mirrored
src/components/ServersLane.tsx          p.pm2 ?? p.docker ?? '?'
```

- **An inventory that says what the script said** — `None` where the script wrote `null`, the container's name modelled and shown.
- **The clippy rule for the Mac day**, recorded here and applied in 55.
- **A build that was never down** — said so, with the box's three containers as the live proof.
