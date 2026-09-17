# 60 — A Partial Listing Is Not a Scan

**Branch:** `60.partial-listing` — `git checkout 60.partial-listing` gives you this chapter's finished app; `git diff 59.clean-environment 60.partial-listing` is exactly what this chapter adds.

**Starting from:** chapter 59 — what DevGo opens gets a clean environment.

**Goal:** a WSL workspace — call it `~/projects` — holds six projects and DevGo showed five, refresh or not; the missing one was always the same. The chapter is short because the fix is one decision, but the investigation is the lesson: three plausible causes were checked and ruled out before the one that could be *proven* was closed.

> **Hold on to:**
> 1. **`entry.ok()?` inside `filter_map` turns an error into a shorter list.** `read_dir` yields `Result<DirEntry>` per entry; skipping the `Err` ones is right when an entry is genuinely unreadable and wrong when the *listing* is failing. Over a network file system the second is the common case.
> 2. **A successful outcome is a promise to the cache.** Chapter 6's `ScanOutcome::Scanned` is stored as the truth and shown on every pass that cannot scan live (`Showing cached projects — WSL stopped`). Anything that is not the whole truth must not be `Scanned`; `Unavailable` keeps the last complete list on screen instead.
> 3. **Rule out before you fix.** Name filters, frontend drops, symlinks, a stale cache — each checked and cleared, in that order, before a line of Rust changed. The chapter does *not* claim the hole it closes was the cause; it claims it is the only way the code as written can produce a believed short list.
>
> Rust: `iter.collect::<Result<Vec<_>, _>>()` — collecting an iterator of `Result`s into a `Result` of a collection stops at the first `Err` and hands it back; the `Ok` holds every item. One line that says "all or nothing".

**Shape of the chapter.** `scan_flat` (`scanner.rs`) as it stands: one `read_dir`, the `Unavailable` match on the open error, `entry.ok()?` as the first line of the `filter_map`. `UnavailableReason::NotMounted` exists (`not mounted` in `ProjectTree`'s `REASON_LABEL`). The nested scanners (`scan_windows_nested`, `scan_wsl_nested`) are not touched: the depth-1 path over `\\wsl.localhost\` is the one that cold-boots the distro.

---

## 60.1 — Rule out before you fix

What the evidence said, in the order it was gathered:

| suspicion | check | verdict |
|---|---|---|
| the scanner filters by name (a prefix the missing one shares with nothing else?) | grep every `.filter(` in the tree and the hook; the `find` script; the ignore list | nothing matches on a name beyond `.`-prefix and the ignore list |
| the frontend drops it (pinned elsewhere, deduped, hidden) | `pinned = []`; `grouped` keys on `p.workspace` only; `filtered` only sorts without a query | it renders whatever the payload holds |
| 9p serves it as a symlink or mount, so `is_dir()` is false | `Get-ChildItem` attributes over `\\wsl.localhost\…`; `findmnt` inside the distro | plain `Directory`, same as its five siblings |
| the scan cache is stale | `scanned_at` per workspace; the running distro; a live ↻ from *stopped* over CDP | a live scan returns **six**; a forced refresh boots the distro and shows six |

So the code, run today, produces six. The five lived in a cache that had been overwritten by the time anyone looked — the real cause is not recoverable. What *is* provable is a way a list can come up short and be believed.

## 60.2 — The one hole that can be proven

`scan_flat` is the depth-1 path: one `read_dir` over `\\wsl.localhost\<distro>\…`, which is the distro's 9p file server, and the request that cold-boots the VM if it is stopped. Opening the listing is one request; every entry after it is another. Then:

```rust
let entry = entry.ok()?;      // ⛔ an entry that errored is simply skipped
```

An `Err` item mid-iteration — the shape a not-yet-ready server produces — was dropped, and the survivors were returned as `ScanOutcome::Scanned`. Chapter 6's cache does exactly what it promises with a successful scan: stores it as the truth. From then on every pass that finds the distro stopped shows *that* list, marked `Showing cached projects — WSL stopped`, and the number is wrong until a live scan happens to succeed in full.

The decision: an entry error is a failed pass, not a shorter list. Between the open-error match and the `filter_map`:

```rust
let entries: Vec<std::fs::DirEntry> =
    match entries.collect::<Result<_, _>>() {
        Ok(entries) => entries,
        Err(_) => {
            return ScanOutcome::Unavailable(UnavailableReason::NotMounted)
        }
    };

let mut projects: Vec<Project> = entries
    .into_iter()
    .filter_map(|entry| {
        let file_type = entry.file_type().ok()?;
        …
```

`Unavailable` is the outcome chapter 6 designed for exactly this: the cache keeps the last *complete* list, the header says *cached*, and the next live pass replaces it. `NotMounted` is the honest reason — "the path does not resolve, or has not finished attaching yet" is what a booting 9p server is. `file_type().ok()?` stays: that one *is* per entry, and a folder whose type cannot be read is not a project.

No test: a mid-iteration `Err` from `read_dir` cannot be staged on a local disk (the OS hands the entries back from one `FindNextFile` loop that does not fail on a healthy volume). The six scanner tests still pass through the new `collect`, which is the proof that a healthy listing is unchanged.

> `✅SCANNER: an entry error fails the pass`

⚠️ What this chapter does not claim: that this was the cause of the five. It is the only way the code as written can produce a believed short list, and it is closed. If a six-project workspace shows five again, the cold repro is `wsl --shutdown`, then ↻ in DevGo, then compare the count with `ls` — and the answer lives in `scanned_at` and the header badge, not in the code.

## 60.3 — Verify

`cargo test` **188** (unchanged), `cargo check` 0 warnings; `tsc -b` and `bun run build` untouched (no frontend change). No dev build: the cold repro needs the distro *stopped*, and WSL was running and left alone — so the repro is recorded, not run. The diff is one `collect` and the reader can see there is no other path out of `scan_flat` than `Scanned` with every entry or `Unavailable`.

> `✅STAGE: 60 partial-listing`; ff-merge; push.

---

## What you built

```
src-tauri/src/services/scanner.rs   scan_flat: collect::<Result<_, _>>() before the filter_map
```

- **A scan that is complete or not a scan** — an entry error makes the workspace unavailable for the pass; the cache is never fed a shortened list.
- **A ruled-out list** — name filters, frontend drops, symlinks and stale caches each checked and cleared before a line changed.
- **A repro you can run cold** — `wsl --shutdown`, ↻, count (owed to a run where the distro may be stopped).
