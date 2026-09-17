# 19 — Polish, Themes & Portability (Slice 10)

**Branch:** `19.themes-portability` — `git checkout 19.themes-portability` gives you this chapter's finished app; `git diff 18.tray-launch 19.themes-portability` is exactly what this chapter adds.

**Starting from:** Slice 9 — DevGo is a complete launcher. It finds, ranks, launches, onboards, and quick-launches from the tray. It has one look, its config lives on one machine, and its search is a substring match.

**Goal:** the last scheduled slice — a theme switcher with five themes, config you can carry to another machine, and fuzzy search on the project list.

> **Hold on to:**
> 1. **A value you centralised is a feature the day you need to change it everywhere.** Chapter 01 put every colour in one `@theme` block as a `--color-*` variable. A theme is a loop that overrides those variables on `:root`; not one component changes.
> 2. **Export what describes how you work, never what describes this machine.** `PortableConfig` is a struct whose shape *is* the decision: workspaces, targets, defaults, hotkey, ignore list — no cache, no history, no pins, no runtime.
> 3. **Import is additive, and the one field that can fail fails softly.** A workspace or target you already have is left alone; a hotkey that will not bind on this machine keeps the old one and does not fail the import.
> 4. **Two locks, one order, everywhere.** `resolve_target` takes the target store and then prefs; import must take them in that order too, or a launch during an import is a deadlock.
>
> Rust: a struct that derives both `Serialize` and `Deserialize` because it crosses the disk in both directions; `Option::filter`. TypeScript: a string-literal union (`ThemeKey`) as the key of a `Record`, so a palette that forgets a colour is a type error, not a leaked border.

> This is the closing chapter of the plan, so it is fitting that its headline feature is a decision that paid off eighteen chapters late. In chapter 01 the design put every colour into one `@theme` block as a variable instead of scattering hex values through components. There was no theme switcher then and no plan for one — it was just the tidy thing to do. This chapter is the invoice arriving with a credit on it: because the colours were centralised as variables, **a theme switcher is a file of palettes and a function that overrides variables — and no component changes.**
>
> The rest is the same shape at smaller scale — fuzzy search is chapter 16's matcher used a third time — plus portability, which is one clean idea, and then the plan ends. Rust first, seven commits; then the frontend, seven more.

---

## 19.1 — Three small pieces that were waiting for a caller

Chapter 09 shipped `register` alone; `rebind` and `unregister` arrive here beside it, because import is their first caller. Chapter 11's Shortcuts panel still says "rebinding is not built yet". Import is the first caller, so this is the chapter that types them. Three preparatory commits, each a few lines.

The cache gets a way to forget everything. In `src-tauri/src/services/project_cache.rs`, above `save`:

```rust
    // the machine-local file; a fresh scan rebuilds it
    pub fn clear(&mut self) -> Result<(), AppError> {
        if !self.entries.is_empty() {
            self.entries.clear();
            self.save()?;
        }
        Ok(())
    }
```

The `is_empty` guard is the same one `retain` uses: no write when nothing changed. And a test beside chapter 18's, because the point of `clear` is that it *persists* — an in-memory clear that a restart undid would be worse than none:

```rust
    #[test]
    fn clear_forgets_everything_on_disk() {
        let dir = std::env::temp_dir().join("devgo-cache-test-clear");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut s = ProjectCacheStore::new(dir.clone()).unwrap();
        s.store(r"G:\a", vec![project("api", r"G:\a")]).unwrap();
        s.clear().unwrap();

        assert!(s.all_projects().is_empty());
        let reloaded = ProjectCacheStore::new(dir).unwrap();
        assert!(reloaded.get(r"G:\a").is_none(), "clear must persist");
    }
```

> `✅CACHE: clear` → `✅TEST: cache clear`

The hotkey can be swapped. At the bottom of `src-tauri/src/summon.rs`:

```rust
pub fn unregister(app: &AppHandle, accelerator: &str) {
    if let Ok(shortcut) = parse(accelerator) {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

// register first: if the new one fails the user keeps a working hotkey
pub fn rebind(
    app: &AppHandle,
    previous: &str,
    next: &str,
) -> Result<(), String> {
    if previous == next {
        return Ok(());
    }
    register(app, next)?;
    unregister(app, previous);
    Ok(())
}
```

The order in `rebind` is the whole function. Register the new chord *first*; if another app owns it, `register` returns `Err`, the `?` returns it, and the old chord is still bound — nothing was unregistered. Only once the new one is in do we drop the old. The opposite order has a window where DevGo has no hotkey, and a failure in that window leaves it that way.

And the store learns to persist one. In `preferences.rs`, after `summon_hotkey`:

```rust
    pub fn set_summon_hotkey(
        &mut self,
        accelerator: Option<String>,
    ) -> Result<(), String> {
        self.prefs.summon_hotkey = accelerator;
        self.save()
    }
```

`Option` because the field is `Option`: `None` means "the default", which is how a fresh `prefs.json` reads.

> `✅SUMMON: unregister and rebind` → `✅PREFS: set_summon_hotkey`. Four dead-code warnings until 19.3 calls them.

---

## 19.2 — Export what describes you, not the machine

Portability is one command each way, and the whole design is in what the exported struct contains — and, more importantly, what it does not. In `src-tauri/src/commands.rs`, above `reveal_in_explorer`:

```rust
// how you work, never this machine: no cache, no history, no pins, no runtime
#[derive(Serialize, serde::Deserialize)]
pub struct PortableConfig {
    pub workspaces: Vec<String>,
    pub targets: Vec<LaunchTarget>,
    pub default_editor: Option<String>,
    pub default_terminal: Option<String>,
    pub summon_hotkey: String,
    pub scan_config: crate::services::preferences::ScanConfig,
}

// the backend writes the file; the frontend only picks where
#[tauri::command]
pub fn export_config_to_file(
    path: String,
    state: State<AppState>,
) -> Result<(), AppError> {
    let workspaces = state.workspace_store.lock().map_err(lock_err)?.list();
    let targets = state.target_store.lock().map_err(lock_err)?.list();
    let config = {
        let prefs = state.pref_store.lock().map_err(lock_err)?;
        PortableConfig {
            workspaces,
            targets,
            default_editor: prefs.default_target(TargetKind::Editor),
            default_terminal: prefs.default_target(TargetKind::Terminal),
            summon_hotkey: prefs.summon_hotkey(),
            scan_config: prefs.scan_config(),
        }
    };
    std::fs::write(&path, serde_json::to_string_pretty(&config)?)?;
    Ok(())
}
```

The one-line comment is the list that matters. DevGo has five JSON files of state, and only some of it is *you*. Your workspaces, your editors, your default terminal, your hotkey, your ignore list — those describe how you work and belong on every machine you use. Your `projects-cache.json` is a snapshot of *this* machine's disk, full of `G:\` and `\\wsl.localhost\` paths that mean nothing on a laptop with different drives. Your launch history and pins are *this* machine's habits. The cached runtime is *this* machine's WSL. Carrying any of them to a fresh install imports a lie — projects that do not exist there, a ranking built from a different week. So `PortableConfig` is the deliberate subset, and the plan's own note — "export the config, never `projects-cache.json`" — is honoured by the struct's shape.

`serde::Deserialize` spelled out because `commands.rs` only imports `Serialize` — every other struct in the file goes one way, to the frontend. This one comes back. The two `?` on the last line are chapter 02's `From` conversions: `serde_json::Error` and `io::Error` both already turn into `AppError`.

Register it in `lib.rs` after `commands::set_scan_config`.

> `✅CONFIG: export_config_to_file`

---

## 19.3 — Import is additive

```rust
// additive: what is already here stays; returns the workspaces for a rescan
#[tauri::command]
pub fn import_config_from_file(
    path: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<Vec<String>, AppError> {
    let config: PortableConfig =
        serde_json::from_str(&std::fs::read_to_string(&path)?)?;

    {
        let mut ws = state.workspace_store.lock().map_err(lock_err)?;
        for w in &config.workspaces {
            // add dedupes by path
            let _ = ws.add(w);
        }
    }
    let (editor, terminal) = {
        let mut store = state.target_store.lock().map_err(lock_err)?;
        for t in config.targets {
            if store.get(&t.id).is_none() {
                let _ = store.add(t);
            }
        }
        // a default only for a target that exists here now
        (
            config.default_editor.filter(|id| store.get(id).is_some()),
            config.default_terminal.filter(|id| store.get(id).is_some()),
        )
    };
    {
        let mut prefs = state.pref_store.lock().map_err(lock_err)?;
        prefs
            .set_scan_config(config.scan_config)
            .map_err(AppError::Lock)?;
        if let Some(id) = editor {
            prefs
                .set_default_target(TargetKind::Editor, &id)
                .map_err(AppError::Lock)?;
        }
        if let Some(id) = terminal {
            prefs
                .set_default_target(TargetKind::Terminal, &id)
                .map_err(AppError::Lock)?;
        }
    }

    // best effort: the key may be taken on this machine, and that must not
    // fail the import. persisted only if it binds
    let previous = state.pref_store.lock().map_err(lock_err)?.summon_hotkey();
    if config.summon_hotkey != previous
        && crate::summon::rebind(&app, &previous, &config.summon_hotkey).is_ok()
    {
        let _ = state
            .pref_store
            .lock()
            .map_err(lock_err)?
            .set_summon_hotkey(Some(config.summon_hotkey));
    }

    Ok(state.workspace_store.lock().map_err(lock_err)?.list())
}
```

Every clause is a decision about not destroying what is already there. A workspace you already have is skipped — chapter 02's `add` dedupes by normalised path, so the `let _ =` is not swallowing an error, it is ignoring "already present". A target whose id you already have is left alone, checked with `get` before `add` because chapter 13's `add` *rejects* a duplicate id with `TargetExists`, and an import that stopped at the first target you both own would be useless. Import a colleague's config and you gain their editors and workspaces without losing yours. The alternative — import overwrites — would make "try importing this" a destructive act you would hesitate to do, and the whole point of portability is that it is cheap to try.

The defaults are the subtle one. A config can name `default_editor: "zed"` from a machine where Zed is registered; on this machine the target may not exist — or may exist, added a moment ago by the loop above. So the check happens *after* the targets are merged, and `Option::filter` keeps the id only if `store.get` finds it. A default that pointed at nothing would be exactly the case chapter 13's `resolve_target` fallback exists for, but there is no reason to write one on purpose.

**The lock order is the launcher's.** The three braced blocks take `workspace_store`, then `target_store`, then `pref_store`, each released before the next. Taking prefs first and the target store *inside* the prefs block would invert the order of `resolve_target`, which runs on every launch and takes the target store first and then prefs. Two threads taking the same two locks in opposite orders is the deadlock in every textbook: an import that holds prefs while a tray launch holds targets, each waiting for the other. Computing `(editor, terminal)` inside the target block and carrying two `Option<String>`s out is what lets the prefs block never touch the target store at all.

The summon hotkey is the one field that can *fail* to import, and it fails softly. On the new machine another app might already own `Ctrl+Alt+Space`. Chapter 09 made a failed registration non-fatal at startup for exactly this reason; here the same principle applies to import — a hotkey that will not bind must not take the workspaces and editors down with it. `rebind` is attempted and the result persisted only on `is_ok()`; the import succeeds either way, you just keep the old chord. `app: tauri::AppHandle` is injected, as in chapter 18, because `rebind` needs the global-shortcut plugin.

Register it after `export_config_to_file`.

> `✅CONFIG: import_config_from_file` — three of the four warnings gone.

---

## 19.4 — Reset the cache

```rust
#[tauri::command]
pub fn reset_cache(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), AppError> {
    state.cache_store.lock().map_err(lock_err)?.clear()?;
    crate::tray::refresh(&app);
    Ok(())
}
```

The tray reads the cache (chapter 18), so a cleared cache is a tray with no recents until the next scan — `refresh` makes the menu say so immediately rather than offering projects that are no longer in the file it reads. Register it after `import_config_from_file`.

> `✅CACHE: reset_cache command`. `cargo check` is clean; `cargo test` reports **48**.

---

## 19.5 — A theme is a variable override, because chapter 01 said so

The types first, in `src/types.d.ts` after `ScanConfig`:

```typescript
// the --color-* names in index.css; a theme must set every one
type ThemeKey =
	| 'bg-primary'
	| 'bg-secondary'
	| 'bg-panel'
	| 'bg-hover'
	| 'bg-selected'
	| 'text-primary'
	| 'text-secondary'
	| 'text-muted'
	| 'accent'
	| 'accent-hover'
	| 'danger'
	| 'border';

interface Theme {
	id: string;
	name: string;
	colors: Record<ThemeKey, string>;
}
```

and, after `ScanningPanelProps`, the Config panel's props — `ConfigPanelProps { onChanged: () => void; onError: (message: string) => void }` — which 19.7 will read.

`Record<string, string>` with a runtime walk over a canonical key list would stop a theme that forgot `--color-border` from leaving the old theme's border showing through — but only at run time. `Record<ThemeKey, string>` makes that a compile error instead: a palette missing a key does not build. The runtime loop still walks the key list — that is how the variables get set — but the guarantee moved from "the loop will set it to `undefined`" to "you cannot write the theme".

> `✅UI: theme types`

Then the palettes, a new file `src/themes.ts`:

```typescript
// every colour is a --color-* variable, so a theme is an override on :root
const KEYS: ThemeKey[] = [
	'bg-primary',
	'bg-secondary',
	'bg-panel',
	'bg-hover',
	'bg-selected',
	'text-primary',
	'text-secondary',
	'text-muted',
	'accent',
	'accent-hover',
	'danger',
	'border'
];

export const THEMES: Theme[] = [
	{
		id: 'neon',
		name: 'DevGo Neon',
		colors: {
			'bg-primary': '#080c12',
			'bg-secondary': '#0c121c',
			'bg-panel': '#0e1420',
			'bg-hover': '#1a2744',
			'bg-selected': '#1e3a5f',
			'text-primary': '#ffffff',
			'text-secondary': '#a0a0a0',
			'text-muted': '#6b7280',
			accent: '#3b82f6',
			'accent-hover': '#2563eb',
			danger: '#ef4444',
			border: '#1e293b'
		}
	},
	// matrix, nord, dracula, black — each setting the same twelve keys
];

const THEME_KEY = 'devgo.theme';
const DEFAULT = 'neon';

export const savedThemeId = () => localStorage.getItem(THEME_KEY) ?? DEFAULT;

export const applyTheme = (id: string) => {
	const theme = THEMES.find(t => t.id === id) ?? THEMES[0];
	const root = document.documentElement;
	for (const key of KEYS) {
		root.style.setProperty(`--color-${key}`, theme.colors[key]);
	}
};

// the variables are live: the whole window recolours as they change
export const setTheme = (id: string) => {
	localStorage.setItem(THEME_KEY, id);
	applyTheme(id);
};
```

The Neon palette is chapter 01's `@theme` block, value for value — the default theme *is* the stylesheet, so applying it changes nothing. The other four are on the branch; type them or paste them, the shape is identical. `applyTheme` is the entire theming engine, and it works only because of a chain of decisions already in place. Chapter 01 wrote the colours as CSS variables in `@theme`. Tailwind v4 compiles a utility like `bg-bg-panel` to `background-color: var(--color-bg-panel)` — it *references* the variable, it does not inline the hex. So a component that says `className='bg-bg-panel'` is really saying "whatever `--color-bg-panel` currently is". Override that variable on `:root` at runtime and every element using the utility recolours on the next frame. No component reads `themes.ts`; no component knows a theme was switched.

The choice lives in `localStorage`, like `sortMode` and the last Settings panel: frontend-only UI state that nothing in Rust reads, so it never goes near `prefs.json` — and, by the same rule as 19.2, never travels in an export.

> `✅UI: five themes`

The saved theme applies **before the first paint**, in `src/main.tsx`:

```tsx
import { applyTheme, savedThemeId } from './themes';

// before the first paint, so a themed install never flashes the default
applyTheme(savedThemeId());

ReactDOM.createRoot(
```

Applying it inside a React effect would paint the default palette first and repaint the saved one a frame later — the flash-of-wrong-theme every themed app has to design around. Setting the variables before `createRoot` runs means the first paint is already correct.

> `✅UI: theme before first paint`

---

## 19.6 — The Appearance panel, and one more `Button` variant

There is one `Button`, and a theme card is a shape it does not have yet: full width, a column, left-aligned, a border that turns accent when chosen. Chapter 11's `tab` variant solved the same problem — a sidebar item selected by `aria-current` — and the same trick fits here with `aria-pressed`, the attribute for a toggle among choices. In `src/components/Button.tsx`, after `badge`:

```typescript
	// A choice among several; the chosen one says so with aria-pressed.
	card: 'flex-col items-stretch w-full p-3 text-left border border-border bg-transparent text-text-primary hover:border-text-muted aria-[pressed=true]:border-accent aria-[pressed=true]:bg-bg-hover/40'
```

and `'card'` joins `ButtonVariant` in `types.d.ts`. Chapter 11's class-order rule is in play: `items-stretch` beats the base's `items-center` because same-property utilities emit alphabetically, and `text-left` and `w-full` have nothing in the base to fight. What could *not* be overridden — `inline-flex` — did not need to be: an inline-flex column at `w-full` is a block.

> `✅UI: button card variant`

The panel, in `Settings.tsx` above `Settings`, with `import { savedThemeId, setTheme, THEMES } from '../themes';`:

```tsx
const SWATCHES: ThemeKey[] = [
	'bg-primary',
	'bg-panel',
	'accent',
	'text-primary',
	'danger'
];

// no reload, no round trip: a theme is CSS variables and lives in localStorage
const AppearancePanel = () => {
	const [current, setCurrent] = useState(savedThemeId());
	const pick = (id: string) => {
		setTheme(id);
		setCurrent(id);
	};

	return (
		<div>
			<h4 className={heading}>Theme</h4>
			<div className='grid grid-cols-2 gap-2.5'>
				{THEMES.map(t => (
					<Button
						key={t.id}
						variant='card'
						aria-pressed={t.id === current}
						onClick={() => pick(t.id)}
					>
						<span className='flex items-center justify-between mb-2'>
							<span className='text-[13px]'>{t.name}</span>
							{t.id === current && (
								<span className='text-accent text-xs'>✓</span>
							)}
						</span>
						<span className='flex gap-1'>
							{SWATCHES.map(k => (
								<span
									key={k}
									className='w-6 h-6 rounded border border-white/10'
									style={{ background: t.colors[k] }}
								/>
							))}
						</span>
					</Button>
				))}
			</div>
		</div>
	);
};
```

and one more object in the registry, after Shortcuts: `{ id: 'appearance', label: 'Appearance', render: () => <AppearancePanel /> }`. The swatches are the only place in DevGo with an inline `style` — they show a palette that is *not* the current one, so they cannot use the variables. Click a theme and the Settings modal you clicked it in recolours under your cursor, because it is drawn from the same variables as everything else. **Centralising a value is a small tidiness the day you do it and a whole feature the day you need to change it everywhere at once.**

> `✅UI: appearance panel`

---

## 19.7 — The Config panel, and three readers to reload

The backend does the file IO — `export_config_to_file` writes, `import_config_from_file` reads — so the frontend needs no filesystem plugin. The panel runs the dialogs and hands over a path: the same split chapter 15 used for `get_wsl_path`, the frontend doing the part that needs a user and the backend the part that needs the disk. Above `Settings`, with `import { open as openDialog, save } from '@tauri-apps/plugin-dialog';` (`open` is already a prop name in this file):

```tsx
const FILTERS = [{ name: 'JSON', extensions: ['json'] }];

// the backend does the file io; this panel runs the dialogs and hands over
// the path
const ConfigPanel = ({ onChanged, onError }: ConfigPanelProps) => {
	const [msg, setMsg] = useState<string | null>(null);

	// null means the dialog was cancelled: nothing to say
	const attempt = async (action: () => Promise<string | null>) => {
		try {
			const done = await action();
			if (done) setMsg(done);
		} catch (e) {
			onError(String(e));
		}
	};

	const exportConfig = () =>
		attempt(async () => {
			const path = await save({
				defaultPath: 'devgo-config.json',
				filters: FILTERS
			});
			if (!path) return null;
			await invoke('export_config_to_file', { path });
			return 'Exported.';
		});

	const importConfig = () =>
		attempt(async () => {
			const path = await openDialog({ filters: FILTERS });
			if (typeof path !== 'string') return null;
			await invoke('import_config_from_file', { path });
			onChanged();
			return 'Imported.';
		});

	const resetCache = () =>
		attempt(async () => {
			await invoke('reset_cache');
			onChanged();
			return 'Cache cleared.';
		});

	const sections = [
		{
			title: 'Export / Import',
			text: 'Carry your workspaces, editors and settings to another machine as one file. Import is additive — it never removes what you already have. The project cache is deliberately not exported; those paths are machine-local.',
			actions: [
				{ label: 'Export…', onClick: exportConfig },
				{ label: 'Import…', onClick: importConfig }
			]
		},
		{
			title: 'Project cache',
			text: 'Clear the cached project list. The next scan rebuilds it — useful if a moved or renamed folder is lingering.',
			actions: [{ label: 'Reset cache', onClick: resetCache }]
		}
	];

	return (
		<div className='flex flex-col gap-5'>
			{sections.map(s => (
				<div key={s.title}>
					<h4 className={heading}>{s.title}</h4>
					<p className='text-xs text-text-muted mb-3'>{s.text}</p>
					<div className='flex gap-2'>
						{s.actions.map(a => (
							<Button key={a.label} onClick={a.onClick}>
								{a.label}
							</Button>
						))}
					</div>
				</div>
			))}
			{msg && <p className='text-xs text-accent'>{msg}</p>}
		</div>
	);
};
```

Three copies of the same `try { … } catch (e) { onError(String(e)) }` and two hand-written sections would say one thing three times; `attempt` holds the one shape and `sections` holds the two blocks, mapped. `null` is how a cancelled dialog says "no message" without being an error. The three `Button`s are the default `secondary` variant.

The registry gains `{ id: 'config', label: 'Config', render: () => <ConfigPanel {...{ onChanged: onImported, onError }} /> }`, and `Settings` takes one more prop, `onImported`, declared in `SettingsProps`. What `App` passes for it is the part that is easy to get wrong: wiring it to the same `refresh()` as the Scanning panel would re-scan projects and nothing else. An import touches three stores, and each has its own reader in `App`: the workspace list (`useWorkspaces`, chapter 17's "two views of one state"), the project list, and the hotkey the Shortcuts panel shows. In `App.tsx`, the mount-time read becomes a function it can call again:

```tsx
	const [summonHotkey, setSummonHotkey] = useState('Ctrl+Alt+Space');
	const loadHotkey = () =>
		invoke<string>('get_summon_hotkey').then(setSummonHotkey).catch(() => {});
	useEffect(() => {
		loadHotkey();
	}, []);
```

and the `Settings` element gets:

```tsx
						onScanChanged: () => refresh(),
						// an import touches three stores; each has its own reader
						onImported: () => {
							refreshWorkspaces();
							refresh();
							loadHotkey();
						}
```

Import a config with a new workspace and a new hotkey: the Workspaces panel lists the folder and the Shortcuts panel shows the chord, without closing Settings.

> `✅UI: config panel`

---

## 19.8 — One matcher, three uses

The project search was a substring `includes`; it is now chapter 16's fuzzy matcher, used a third time. In `src/hooks/useProjects.ts`, `import { fuzzyScore } from '../palette';`, and the derivation at the bottom becomes:

```tsx
	const q = query.trim();

	// Both ranked modes fall back to name, so the long tail (equal scores, or
	// projects with no git history) keeps a stable alphabetical order instead
	// of whatever the scan happened to return. `[...projects]` because sort
	// mutates.
	const byName = (a: Project, b: Project) =>
		a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	// … byActivity, byFrecency unchanged …

	// the palette's matcher, a third time: `dvgo` finds `devgo-app`. while you
	// type, the top hit belongs under Enter, so best match first
	const filtered = q
		? projects
				.map(p => ({ p, s: fuzzyScore(q, p.name) }))
				.filter((x): x is { p: Project; s: number } => x.s !== null)
				.sort((a, b) => (b.s !== a.s ? b.s - a.s : byName(a.p, b.p)))
				.map(x => x.p)
		: sortMode === 'name'
			? projects
			: [...projects].sort(sortMode === 'activity' ? byActivity : byFrecency);
```

`fuzzyScore` was written for the command palette and is imported unchanged — it lowercases both sides itself, which is why the `.toLowerCase()` on `q` goes. `dvgo` finds `devgo-app` in the project list exactly as it finds "Open terminal" in the palette. With a query, the list sorts best-match-first, because a searcher is aiming for the top hit under Enter — chapter 05's `handleSearchEnter` launches `filtered[0]` — not browsing frecency order. With no query, the chosen sort mode is untouched. The type predicate on `filter` is what lets `sort` read `.s` as a number two lines later. **A matcher good enough for one search is good enough for every search, and the third caller costs an import.**

> `✅UI: fuzzy project search`

**The fade-in that needed no fixing.** `Toast` has said `animate-fade-in` since chapter 02, and chapter 02's `@theme` edit already carries the keyframes in `index.css`, so there is nothing to add here.

Nothing to commit on this branch.

---

## 19.9 — What the plan refused *(skip on first pass)*

The launcher plan is done — ten slices, nineteen chapters — and the honest way to close it is not a list of features but an accounting of restraint, because the through-line was never "add everything the plan listed". It was "add what serves the wedge, and write down why the rest didn't".

- **Slice 6** shipped a network-share warning and refused NTFS detection, mapped-drive detection, and an always-on "recommended runtime" badge — DevGo already routes by filesystem, so the advice would restate its own behaviour on every row.
- **Slice 8** shipped an ignore filter and refused configurable depth, monorepo expansion, and a filesystem watcher — each would put cost on the scan hot path, which multiplies over 9p, the one thing DevGo cannot spend.
- **Slice 9** shipped tray quick-launch and refused all of session tracking — holding process handles is a terminal multiplexer, a different product, and "reopen terminals on launch" was a Core Rule violation with a nice name.
- **Slice 10** shipped file export and refused gist-backed sync — a GitHub token and a network round trip to move a file you can already copy, against a wedge that is offline and WSL-first.

Those refusals are not the plan going unfinished. They are the plan being *read correctly* — the recurring question it was built to keep answering: *what is the tightest version that makes a WSL/remote dev actually switch, and what is scope creep wearing a checkbox?*

And under every one of those decisions was one law, stated in chapter 06 and never once bent: **DevGo touches WSL only when you ask it to.** It shaped the scanner (skip stopped distros), git and badges (batched, gated, off the hot path), onboarding (discover only running distros, drop without probing), the tray (render from the cache, launch on a click), and this chapter (reset the cache and the stopped distro's projects simply wait; nothing boots to refill them). Nineteen chapters of features, and not one of them boots a distro you did not ask to open. That invariant is the actual product. The features are what you see; the law is why they are worth using.

---

## 19.10 — Verify

```powershell
cd src-tauri
cargo test
cd ..
bun tauri dev
```

`cargo test` reports **48** — chapter 18's 47 plus `clear_forgets_everything_on_disk`. `tsc -b` and `bun run build` clean. Then, with WSL stopped throughout:

**Fuzzy.** Type `dvgo`: every `devgo*` project, `devgo` itself first (equal scores, name breaks the tie). Type `dgtut`: `devgo-tutorials` — a row a substring match would never have found. Clear it: the frecency order is back.

**Themes.** `Ctrl+,` → Appearance: five cards, *DevGo Neon* ticked. Click *Nord*: the whole window recolours — the modal you are in, the list behind it, the title bar — and `getComputedStyle(document.documentElement).getPropertyValue('--color-accent')` reads `#88c0d0`, `localStorage.devgo.theme` reads `nord`. Reload the page (`location.reload()` from devtools): it comes up Nord with no flash of blue, because `main.tsx` set the variables before React mounted.

**Export.** Config → *Export…*: a Save dialog with `devgo-config.json` filled in. Save it somewhere and open it: exactly six keys — `workspaces` (7 here), `targets` (2), `default_editor`, `default_terminal`, `summon_hotkey`, `scan_config` — and *Exported.* under the buttons. No cache, no stats, no pins.

**Import.** Copy the file, and in the copy add a workspace path (a scratch folder with two subfolders), change `summon_hotkey` to `Ctrl+Alt+F9`, and append a name to `ignore`. *Import…*, pick it: *Imported.*; `workspaces.json` has one more entry, `prefs.json` shows the new hotkey and the longer ignore list, and the default editor is unchanged. Without closing Settings: the Shortcuts panel now shows `Ctrl+Alt+F9`, the Workspaces panel lists the scratch folder. Press `Ctrl+Alt+F9`: the window hides; again: it is back. The old chord is dead — `rebind` unregistered it.

**Reset.** Config → *Reset cache*: *Cache cleared.*, and `projects-cache.json` a moment later holds only the workspaces that could be scanned live — the Windows ones, the scratch folder included — because the rescan `onChanged` triggered rebuilt them. The WSL workspaces read *Unavailable* with no count; `wsl -l -q --running` is still empty. They are back the next time the distro is running and you press F5.

Put `prefs.json` and `workspaces.json` back when done (or remove the scratch workspace and re-import your original export — which is, after all, the feature).

> `✅STAGE: 19 themes-portability`; ff-merge; push.

---

## What you built

```
src-tauri/src/
├── commands.rs                ← PortableConfig, export_config_to_file, import_config_from_file
│                                 (workspace → target → prefs lock order), reset_cache
├── summon.rs                  ← unregister, rebind (register first)
├── lib.rs                     ← three commands
└── services/
    ├── project_cache.rs       ← clear + test
    └── preferences.rs         ← set_summon_hotkey
src/
├── themes.ts                  ← NEW: KEYS, THEMES (five), savedThemeId, applyTheme, setTheme
├── main.tsx                   ← applyTheme before createRoot
├── types.d.ts                 ← ThemeKey, Theme, ConfigPanelProps, ButtonVariant 'card',
│                                 SettingsProps.onImported
├── hooks/useProjects.ts       ← fuzzyScore, best-match-first under a query
├── components/
│   ├── Button.tsx             ← card variant (aria-pressed)
│   └── Settings.tsx           ← AppearancePanel, ConfigPanel, two registry entries
└── App.tsx                    ← loadHotkey; onImported reloads workspaces, projects, hotkey
```

> **The thread running through Slice 10.** A theme switcher that touched no component, because chapter 01 centralised the colours; an export whose struct is the decision about what travels; an import that adds and never removes, takes its locks in the launcher's order, and lets the one fallible field fail alone; and a search that borrowed the palette's matcher. **The measure of the whole plan is that it stayed narrow while it got capable** — nineteen chapters, and the app still boots no distro you did not ask for.

---

→ Next: [20 — The Settings That Were Already There](./20-settings-surface.md) (post-plan) — the launcher plan ends here; the book does not. It surfaces the settings this plan left hidden: a gear button, the hotkey rebind chapter 11's Shortcuts panel promised (its `rebind` is now typed), and the script runner chapter 14 deferred.

→ Reference: [Rust Concepts](./appendix/rust-concepts.md) | [Tauri Concepts](./appendix/tauri-concepts.md)

→ Back to: [18 — Tray Quick-Launch](./18-tray-launch.md)
