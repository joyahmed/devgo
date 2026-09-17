# 64 — Every File System, Named

**Branch:** `64.filesystems` — `git checkout 64.filesystems` gives you this chapter's finished app; `git diff 63.menu-audit 64.filesystems` is exactly what this chapter adds.

**Starting from:** chapter 63 — every menu, read once.

**Goal:** the title bar names every file system DevGo scans, not just the one that can wedge. It showed WSL alone; the machine's own disk belongs there too — Windows on Windows, Mac on a Mac. The machine's own disk comes first — `Windows` here, `Mac` on a Mac — with the same light the WSL chip has (always lit: the local disk is always up), then `WSL · n running` with its light and its menu exactly as chapter 62 left them. Where there is no WSL, the local chip alone.

> **Hold on to:**
> 1. **A word the frontend shows but never spells.** `"Windows"` was the `file_system` string since chapter 03, but it was Rust's word (the scanner's), and the title bar must not type it a second time: a Mac would say *Windows*. `LOCAL_FS` is one `const` under three `cfg`s, and it rides to the frontend as a field of `RuntimeInfo`.
> 2. **On the wire, never read back.** `RuntimeInfo` is cached in `prefs.json` (chapter 08's *startup must not shell out to wsl.exe*). A field that is a compile-time constant must be *written* into the cache and *ignored* when the cache comes back — `#[serde(skip_deserializing, default = …)]` — or a prefs file from an older build fails to parse, and one another OS wrote lies.
> 3. **A table of chips, mapped.** Two chips are not `<Chip/><Chip/>`; they are one array and one `map`, so the third file system (the Mac's, or a network share one day) is a row, not a copy. The WSL chip's menu rides along as a slot on the row.

> Rust: a `pub const` under `#[cfg(windows)]`, `#[cfg(target_os = "macos")]` and `#[cfg(not(any(…)))]` is one name with three bodies; the compiler keeps one. `&'static str` in a struct that derives `Deserialize` is fine when the field is `skip_deserializing` — serde never has to make one.

---

## 64.1 — The local file system's name

`scanner.rs`, above `detect_file_system`. The string that was inline since 03 gets a name and two siblings:

```rust
// the file system of a path on this machine's own disk: the word the rows
// and the title bar show for it. wsl and network are unc kinds, windows only
#[cfg(windows)]
pub const LOCAL_FS: &str = "Windows";
#[cfg(target_os = "macos")]
pub const LOCAL_FS: &str = "Mac";
#[cfg(not(any(windows, target_os = "macos")))]
pub const LOCAL_FS: &str = "Linux";
```

`detect_file_system`'s last arm returns `LOCAL_FS`; `classifies_filesystem_kinds` still asserts `"Windows"` for `G:_tauri` (this chapter's tests only ever ran on Windows — chapter 55's `ef85276` turns that line into a `LOCAL_FS` assertion on a plain path with the `"Windows"` one behind `#[cfg(windows)]`). The rows already show `p.file_system`, so on a Mac they will read *Mac* with no frontend change. (The `"Windows"` literals in the tests and in the servers' stand-in `Project`s — 47's `USERPROFILE` home — stay: they are Windows paths on Windows tests, chapter 55's to move.)

> `✅SCANNER: local file system name`

## 64.2 — Runtime info carries it

`platform/detection.rs`:

```rust
use super::runtime::Runtime;
use crate::services::scanner::LOCAL_FS;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub runtime: Runtime,
    pub wsl_available: bool,
    pub distros: Vec<String>,
    pub default_distro: Option<String>,
    // the name of this machine's own file system, so the frontend never
    // spells it. on the wire only: prefs.json may have been written by an
    // older build or another os, and the constant is the truth here
    #[serde(skip_deserializing, default = "local_fs")]
    pub local_fs: &'static str,
}

fn local_fs() -> &'static str {
    LOCAL_FS
}
```

Both `RuntimeInfo { … }` literals in `detect_runtime` gain `local_fs: LOCAL_FS`, and so do the three in `launcher.rs`'s tests (`no_distro` and two inline). The test, in `detection.rs`'s new `mod tests`: serialise → `json["local_fs"] == LOCAL_FS`; parse the pre-64 shape (no field) → `LOCAL_FS`; parse one with `"local_fs":"Mac"` → still `LOCAL_FS`, and `distros` intact.

```rust
    #[test]
    fn local_fs_is_written_and_never_read_back() {
```

> `✅PLATFORM: runtime info names the local fs`

## 64.3 — The command

`commands.rs`, before `get_wsl_state`. No probe: the cached struct, cloned under the lock (`refresh_projects(force)` is what re-probes it, since 08):

```rust
/// What the machine is: its own file system's name and whether wsl is
/// there at all. The cached probe, so it costs a lock and a clone; the
/// forced refresh is what re-reads it.
#[tauri::command]
pub fn get_runtime_info(
    state: State<AppState>,
) -> Result<RuntimeInfo, AppError> {
    Ok(state.runtime_info.lock().map_err(lock_err)?.clone())
}
```

`lib.rs`: `commands::get_runtime_info,` after `get_wsl_state`. A command and its registration are one commit (62's rule).

> `✅COMMANDS: get_runtime_info`

## 64.4 — The hues, shared

`FS_TONE` and `EDGE` lived in `ProjectTree.tsx` (chapter 56). The title bar needs the same hues, so they move to `rowStyles.ts` behind two functions, with the fallback inside — the local disk is muted *whatever it is called*, so no `Windows` key:

```ts
// a file system's hue, the one the rows' cell, the card's edges and the
// title bar's chips share: wsl in the accent, a share in amber, the
// machine's own disk muted, whatever it is called
const FS_TONE: Record<string, string> = {
	WSL: 'text-accent',
	Network: 'text-amber-400'
};

export const fsTone = (fs: string) => FS_TONE[fs] ?? 'text-text-muted';

// the card's two leading edges in the file system's hue, the one fsTone
// uses: the group says what it is at a glance, and selection stays the
// row's ground and its name
const EDGE: Record<string, string> = {
	WSL: 'border-t-accent/50 border-l-accent/50',
	Network: 'border-t-amber-400/50 border-l-amber-400/50'
};

export const fsEdge = (fs: string) =>
	EDGE[fs] ?? 'border-t-text-muted/40 border-l-text-muted/40';
```

`ProjectTree.tsx`: the two tables go; `FsCell` uses `fsTone(fs)`, the card `fsEdge(fs)`.

> `✅UI: file system hues shared`

## 64.5 — Types, hook

`types.d.ts`, under `WslState`:

```ts
interface RuntimeInfo {
	runtime: 'windows' | 'wsl';
	wsl_available: boolean;
	distros: string[];
	default_distro: string | null;
	local_fs: string;
}
```

and beside `WslControlProps`: `FsChipProps` (`fs`, `label?`, `title`, `light?`, `disabled?`, `menu?: (close: () => void) => React.ReactNode`), `WslMenuProps` (`WslControlProps` + `close`), and `FileSystemsProps extends Omit<WslMenuProps, 'close'>` with `runtime`. The menu is handed the way to close itself: the chip owns *open*, the menu owns *busy*.

> `✅TYPES: runtime info and the chip props`

`hooks/useRuntime.ts` — the shape `useWsl` has, minus the event (nothing pushes runtime info): mount, and `refreshRuntime` for the app to call after every pass. `UNKNOWN` has `local_fs: ''`, and an empty name draws no chip: no chip beats a wrong name for the first frame.

```ts
export const useRuntime = () => {
	const [runtime, setRuntime] = useState<RuntimeInfo>(UNKNOWN);

	const refreshRuntime = () => {
		invoke<RuntimeInfo>('get_runtime_info').then(setRuntime).catch(() => {});
	};

	useEffect(refreshRuntime, []);

	return { runtime, refreshRuntime };
};
```

> `✅HOOKS: useRuntime`

## 64.6 — The chip

`components/FsChip.tsx` is 62's chip generalised: the `Button` badge, the name in `fsTone(fs)`, the rows' 7 px light when the row has one (`light !== undefined`), and — when the row has a menu — the *open* state with 62's outside-click and Escape effect, rendering `menu(close)` under it. A chip with no menu gets no `onClick` and keeps the arrow (`cursor-default!` — the primitive's `cursor-pointer` sits in the same layer, and only the important form wins).

```tsx
			<Button
				variant='badge'
				className={`gap-1.5 ${fsTone(fs)} ${menu ? '' : 'cursor-default!'}`}
				title={title}
				disabled={disabled}
				onClick={menu ? () => setOpen(v => !v) : undefined}
			>
				{light !== undefined && (
					<span
						className={`size-[7px] rounded-full shrink-0 ${
							light
								? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
								: 'border border-text-muted'
						}`}
						aria-hidden='true'
					/>
				)}
				{label}
			</Button>
			{open && menu?.(() => setOpen(false))}
```

`Button.tsx`: the `badge` variant drops its `text-accent` — the hue is the caller's now, the file system's; `disabled:text-text-muted` stays, so a stopped WSL still greys. (`WslControl` gets `text-accent` on its class for the two commits it has left to live, so no commit shows a colourless chip.)

> `✅UI: fs chip`

## 64.7 — The menu, alone

`components/WslMenu.tsx` is `WslControl` with the chip cut off the top: the two sentences, `busy`, `run` — whose `finally` now calls `close()` instead of `setOpen(false)` — and the rows. Nothing else changed; the file is new so that `WslControl` still compiles for one more commit.

> `✅UI: wsl menu under the chip`

## 64.8 — The table

`components/FileSystems.tsx`. `wslChip` turns a `WslState` into a row (62's label and title, `light: up`, `disabled: !running`); the table is the local disk and then, where `wsl_available`, WSL with its menu in the slot; one `map`:

```tsx
const FileSystems = ({ runtime, wsl, ...hands }: FileSystemsProps) => {
	const { local_fs, wsl_available } = runtime;
	const chips: FsChipProps[] = [
		...(local_fs
			? [
					{
						fs: local_fs,
						title: `${local_fs}: this machine's own disk, always up`,
						// the same light as wsl's, and it never goes out
						light: true
					}
				]
			: []),
		...(wsl_available
			? [wslChip(wsl, close => <WslMenu {...{ wsl, close, ...hands }} />)]
			: [])
	];

	return (
		<div className='flex items-center gap-2'>
			{chips.map(c => (
				<FsChip key={c.fs} {...c} />
			))}
		</div>
	);
};
```

> `✅UI: file systems in the title bar`

## 64.9 — Wiring

`App.tsx`: `FileSystems` replaces `WslControl` in the `TitleBar` with `runtime` added to the spread; `useRuntime()` beside `useWsl()`, and the same pass effect 12 gave the WSL chip — `useEffect(refreshRuntime, [workspaceStates])` — so the forced refresh's re-probe lands. `WslControl.tsx` deleted; `WslControlProps` folded into `WslMenuProps`.

> `✅APP: title bar lists the file systems`

Two fixes after the first look, each its own commit: the static chip's arrow (`cursor-default!`, read back as `pointer` before it) and the local chip's light — decided mid-run: the local chip carries *the same circle* as the WSL chip, always lit, same size and position, so the two read as one family. It is the same `<span>` in `FsChip`, lit by `light: true` on the table row, not a copy.

> `✅FIX: a chip with no menu keeps the arrow`
> `✅UI: the local chip is lit too`

## 64.10 — Verify

`cargo test` **195** (194 + `local_fs_is_written_and_never_read_back`; 62's probe ignored), `cargo check` 0 warnings, `tsc -b` and `bun run build` clean. Two dev launches (the second for the light), the fourteen files backed up by hash, the installed DevGo stopped first, WSL running (not by us) and left alone.

- **The wire:** `invoke('get_runtime_info')` → `{ runtime: 'windows', wsl_available: true, distros: ['Ubuntu-26.04'], default_distro: 'Ubuntu-26.04', local_fs: 'Windows' }`. An existing `prefs.json` has no `local_fs` under `cached_runtime` and parses (the `skip_deserializing` half of the test, live).
- **The chips, read over CDP** (`button.rounded-full` in the title bar, left to right): **`Windows`** — title *Windows: this machine's own disk, always up*, colour `rgb(143, 157, 186)` (`text-text-muted`), `cursor: default`, not disabled, dot **7 × 7** `oklch(0.765 0.177 163.223)` (emerald-400) with the **6 px** `rgb(52, 211, 153)` glow, at `y = 14`, `h = 22`; then **`WSL · 1 running`** — title *WSL running: Ubuntu-26.04*, colour `rgb(34, 211, 238)` (`text-accent`), `cursor: pointer`, the same dot, same `y`, same `h`. Two chips, `gap-2`, then `?` and the gear.
- **The control, still there:** a click on the WSL chip → the menu with **`Stop`** beside `Ubuntu-26.04` and **`Shut down all WSL`**; Escape → 0 menus. Not clicked further (not ours to stop).
- **Before the arrow fix** the first read said `cursor: pointer` on `Windows` — `cursor-default` and the primitive's `cursor-pointer` are the same specificity and the stylesheet's order won.
- The Mac chip is not provable here: `LOCAL_FS` is `Mac` under `cfg(target_os = "macos")` and the test asserts the constant, whichever it is. The no-WSL case (one chip) is `wsl_available: false` in the table's second spread; not staged (this machine has a distro).

The dev build stopped, `sha256sum -c`: **14 OK, 0 mismatches** (the run had changed `instance.lock` and `projects-cache.json`, as every start does).

> `✅STAGE: 64 filesystems`; ff-merge; push.

---

## What you built

```
src-tauri/src/services/scanner.rs             LOCAL_FS, three cfgs
src-tauri/src/services/platform/detection.rs  RuntimeInfo.local_fs + 1 test
src-tauri/src/services/launcher.rs            the test literals
src-tauri/src/commands.rs                     get_runtime_info
src-tauri/src/lib.rs                          the registration
src/components/rowStyles.ts                   fsTone, fsEdge
src/components/ProjectTree.tsx                uses them
src/types.d.ts                                RuntimeInfo, FsChipProps, WslMenuProps, FileSystemsProps
src/hooks/useRuntime.ts                       the cached probe, re-read after every pass
src/components/Button.tsx                     badge without a hue of its own
src/components/FsChip.tsx                     the chip: hue, light, menu slot
src/components/WslMenu.tsx                    62's menu, given close
src/components/FileSystems.tsx                the table, mapped
src/components/WslControl.tsx                 gone
src/App.tsx                                   FileSystems in the title bar
```

- **The title bar names the disk you are on** — `Windows` lit, `WSL · 1 running` lit, in the palette the rows already used.
- **One word for the local file system**, defined once in Rust and carried to the frontend on `RuntimeInfo`, so a Mac says *Mac* without a line of TypeScript knowing.
- **A chip family** — `FsChip` with a light and a menu slot; the WSL control is a row in a table, not a special case in the markup.
