# 25 — One Row, Many Editors (post-plan)

**Branch:** `25.launch-surface` — `git checkout 25.launch-surface` gives you this chapter's finished app; `git diff 24.editor-detection 25.launch-surface` is exactly what this chapter adds.

**Starting from:** chapter 24 — DevGo can find every editor installed on the machine and inside every running distro. It still launches into exactly one of them, because the action row has a single *Editor* button and the frontend has never told the backend which target to use.

**Goal:** pick any registered editor or terminal from the row, the palette or a right-click; give *Open Both* the same choice; take workspace management out of the modal it never belonged in; and fix two ways chapter 23's window state could strand the window off-screen.

> **Hold on to:**
> 1. **The capability usually exists; the wiring is the feature.** `target_id` has been on `open_editor` since chapter 13 and the frontend sent `null` every time. Workspace *Add* and `Ctrl+N` opened a settings panel containing the button that did the work. Check what you already have before designing a backend.
> 2. **Act on the thing that was clicked.** `indexOf(selected.workspace)` is the indirection that made `Delete` fall through when the lookup missed; a row that carries its own identity has nothing to fail to resolve.
> 3. **A minimized window is still visible, and its rect is a placeholder.** `(-32000, -32000)` at about 144×19. Save it and the next launch is a taskbar entry with nothing on screen — found by minimizing the app, which no gate was ever going to do. And the write path being fixed is not enough: a config already poisoned needs the *read* path to refuse it.
> 4. **Good reasoning can still produce the wrong layout.** The split button's premises were all true; it was aimed at crowding that a change one section earlier had removed.
>
> Rust: `impl WindowState { … }` methods on a plain data struct, tested against three real monitors; a `type` alias for a tuple that three functions share. TypeScript: a named return type for a hook (`TargetRegistry`) so a component can take the hook's result as a prop; a `Button` variant that reads `aria-current` for "the default".

> Three separate things in this chapter turn out to be the same story. The multi-editor feature is one argument the frontend never sent. The workspace buttons are three entry points that call `openSettings()` and do no work. The keyboard hints are four copies of a chip. In each case the capability already existed and the wiring was the missing part — which is the most common shape a "new feature" actually has.
>
> The two command signatures come first; then two fixes to chapter 23's window state, with their tests — real bugs that shipped in 23, and the launch surface is built on the window they leave behind. The footer's hints stay as chapter 16 left them — the Commands door, no shortcut rows.

---

## 25.1 — The feature was one argument

`open_editor` has looked like this since chapter 13:

```rust
pub fn open_editor(
    project: Project,
    target_id: Option<String>,
    state: State<AppState>,
) -> Result<(), AppError>
```

and `resolve_target` behind it already does explicit id → saved default → first of kind. The frontend: `invoke('open_editor', { project: p, targetId: null })`, with a comment explaining that `null` means "use the default". Every launch DevGo has ever made took the default because **nothing ever sent anything else.**

`open_both` was the exception, and it is worth seeing why rather than assuming it matched: `launch_project_default(state, project)` resolved *both* defaults internally, no ids at all. So "open both, but in Cursor" genuinely was a signature change:

```rust
pub fn launch_project_default(
    state: &AppState,
    project: &Project,
    editor_id: Option<String>,
    terminal_id: Option<String>,
) -> Result<(), AppError> {
```

`open_both` takes the same two `Option<String>`s and passes them through; the tray's `launch` passes `None, None` — a quick-launch from a tray menu has no UI to pick with, and `None` is what that call has always done. One more signature while we are here: `reveal_in_explorer` took a whole `Project` and read `full_path` from it; it takes a `path: String` now, so §25.5 can reveal a workspace with it.

> `✅CMD: reveal_in_explorer takes a path` · `✅CMD: open_both takes target ids`

## 25.2 — Two rects a person never chose

Run chapter 23's app, minimize it, and read `prefs.json`. On this machine the window reported `zoomed=False visible=True rect=-32000,-32000 160x28` while minimized: still `WS_VISIBLE`, so the hidden-window guard let it through, and `remember_geometry` saved a placeholder as if someone had dragged the window there. The next launch restored it — a taskbar entry and nothing on any monitor, which you cannot click your way out of.

The second one is subtler. Maximizing is not atomic: a `Resized` arrives while `is_maximized()` still reports false, so the screen-filling rect is stored as the *restored* one, and the restore button hands back a window the size of the display. A `prefs.json` caught in that state: `{maximized: true, width: 2560, height: 1392, x: -8, y: -8}` — the display, minus nothing.

Both are questions about a rect, so they are methods on `WindowState`, in `preferences.rs`:

```rust
/// A monitor as (x, y, width, height).
pub type MonitorRect = (i32, i32, u32, u32);

// below this the rect is a placeholder something wrote, not a window
// somebody left
const MIN_RESTORE_W: u32 = 320;
const MIN_RESTORE_H: u32 = 240;

impl WindowState {
    /// Does this rect look like a maximized window rather than a restored
    /// one? Maximizing is not atomic: a Resized arrives while is_maximized()
    /// still says false, and the screen-filling rect would be stored as the
    /// restore rect. Windows overhangs a maximized window by its invisible
    /// border, hence the slack.
    pub fn covers_a_monitor(&self, monitors: &[MonitorRect]) -> bool {
        const SLACK: i32 = 24;
        monitors.iter().any(|&(_, _, mw, mh)| {
            (self.width as i32 - mw as i32).abs() <= SLACK
                && (self.height as i32 - mh as i32).abs() <= SLACK * 4
        })
    }

    /// Could a person have left the window here? A minimized window reports
    /// (-32000, -32000) at about 144x19, and a monitor can be unplugged; a
    /// rect that fails either check strands the window off every screen,
    /// with a taskbar entry and nothing to click.
    pub fn is_restorable(&self, monitors: &[MonitorRect]) -> bool {
        if self.width < MIN_RESTORE_W || self.height < MIN_RESTORE_H {
            return false;
        }
        if monitors.is_empty() {
            // no monitor info: the size check alone, rather than refusing
            // every restore
            return true;
        }
        // a real overlap, not a shared edge: one pixel on screen is not
        // reachable in any useful sense
        const MARGIN: i32 = 80;
        let (l, t) = (self.x, self.y);
        let (r, b) = (l + self.width as i32, t + self.height as i32);
        monitors.iter().any(|&(mx, my, mw, mh)| {
            let (mr, mb) = (mx + mw as i32, my + mh as i32);
            let ox = r.min(mr) - l.max(mx);
            let oy = b.min(mb) - t.max(my);
            ox >= MARGIN && oy >= MARGIN
        })
    }
}
```

Six tests, against three real monitors (`(0,0,2560,1440)`, `(-1920,360,1920,1080)`, `(2560,0,2560,1440)`) through one `rect(w, h, x, y)` helper: the poisoned `144×19 @ -32000` is refused with and without monitor info; `2560×1392 @ -8,-8` and the smaller monitor's `1920×1040` are maximize artefacts; `900×720`, `1400×900`, `2000×1200`, `2400×1000` are not; a 900×720 window restores on any of the three monitors; one left on a monitor that is gone is refused; and one with 20px on screen is refused.

> `✅RUST: window rect sanity checks` — **78** tests.

The write path, in `remember_geometry`:

```rust
    // a minimized window is still visible, and reports (-32000, -32000) at
    // 144x19: a placeholder, not a position. saving it stranded the next
    // launch off every monitor
    if window.is_minimized().unwrap_or(false) {
        return;
    }
```

and, in the restored branch, the candidate is checked before it is kept:

```rust
        // maximizing is not atomic: a Resized arrives while is_maximized()
        // still says false, and the screen-filling rect would become the
        // restore rect
        let monitors = window
            .available_monitors()
            .map(|m| monitor_rects(&m))
            .unwrap_or_default();
        if candidate.covers_a_monitor(&monitors) {
            return;
        }
        candidate
```

`monitor_rects` turns Tauri's `Monitor` list into `MonitorRect`s once, for both callers — the alternative is the same conversion inlined twice.

> `✅FIX: minimized and mid-maximize rects are not saved`

The read path, in `setup`, is what repairs a machine that already stored a bad rect. The `match` arm gains a second guard — `Some(s) if !s.maximized && s.is_restorable(&monitors)` — and everything else, including an unshowable rect, falls to the arm that maximizes. Maximized is recoverable; an invisible window is not.

> `✅FIX: refuse an unshowable saved rect`

## 25.3 — The type that was quietly losing fields

`LaunchTarget` in `types.d.ts` had seven fields. The Rust struct has nine — `run_args_template` and `wsl_run_args_template` arrived in chapter 20 with `#[serde(default)]`, so nothing ever errored. The consequence was silent and specific: **every terminal added through the form arrived with `null` run templates**, then failed `TargetCannotRun` the first time anyone ran a dev script on it. The form had no inputs for them either.

Both fields are in the type now, and `TargetDraft` with them. The form shows them for terminals only, since an editor is not a place to run a dev command — a second field list spread in behind the first:

```tsx
// terminals only: blank means the target cannot run dev scripts
const RUN_FIELDS: { key: keyof TargetDraft; placeholder: string }[] = [
	{ key: 'run_args_template', placeholder: 'Run args — {command} in a Windows project' },
	{
		key: 'wsl_run_args_template',
		placeholder: 'WSL run args — {command} in a WSL project'
	}
];
```

```tsx
					{[...FIELDS, ...(kind === 'terminal' ? RUN_FIELDS : [])].map(({ key, placeholder }) => (
```

`submit` trims both to `null` like the WSL fields, and `{command}` joins the placeholder legend. This is also why chapter 24's `add_detected_target` takes an id: routing a detected terminal out through this type and back would have stripped exactly these two fields. Now the type is fixed too.

> `✅UI: run templates in the target form`

Back to the launch argument of 25.1, now on the frontend side. The hook, `useLaunchActions.ts`:

```ts
	const openEditor = (project?: Project, targetId?: string) => {
		const p = project ?? selected;
		if (!p) return Promise.resolve();
		return invoke('open_editor', { project: p, targetId: targetId ?? null });
	};
```

`openTerminal` the same; `openBoth` takes `editorId` and `terminalId`. Omitting the argument still means "use the default", so every existing caller is unchanged. That is the whole backend of "open in a specific editor".

> `✅HOOK: launch actions take a target id`

## 25.4 — One chip

Four `<kbd>` chips in four files with four class strings, no two alike: `ActionButtons` at `text-[10px] text-text-muted`, `CommandPalette` at `text-[10px]`, a `kbd` const in `Settings`, and `StatusBar`'s at `text-[11px] leading-none`. `src/components/Kbd.tsx`:

```tsx
// one chip for every shortcut hint. text-[11px]: the arrows and ⏎ are drawn
// 9-19% shorter than letters, as thin outlines, and vanished at 10px.
// leading-none so a label beside it shares its baseline
const Kbd = ({ children }: KbdProps) => (
	<kbd className='font-mono text-[11px] leading-none shrink-0 px-2 py-1 border border-border-strong rounded bg-bg-panel text-text-primary'>
		{children}
	</kbd>
);
```

Two things learned the hard way are folded in. The "not vertically centred" report was a line-height *mismatch*: the chip had `leading-none` and the label beside it inherited `line-height: normal`, so `items-center` aligned two boxes whose baselines disagreed — the footer's *Commands* label carries `leading-none` now. And "the symbols are invisible" was not font fallback: parse the bundled font's cmap and every glyph is present. They are simply shorter — `⏎` is 680 units to `S`'s 750 — and thin, at the smallest size in the app, inside a 1.3:1 border. Size and the `border-strong` token, not substitution.

> `✅UI: Kbd chip`

## 25.5 — One registry, and buttons that do work

The row needs the target list. `Settings` already called `useTargets()`; the lazy answer is to call it again in `App`. Two copies of a hook are two independent fetches with independent state: add an editor in Settings and the row would not know until the next mount. So the hook lifts to `App` and Settings takes it as a prop. `ReturnType<typeof useTargets>` would be the obvious type for that prop, but `types.d.ts` is ambient and cannot import the hook, so the return type gets a name — `TargetRegistry`, eight members — and `useTargets = (): TargetRegistry =>` promises it.

> `✅UI: one target registry, owned by App`

**Buttons that only open Settings are unfinished buttons.** The complaint was "why do I need to go to settings to add or delete a workspace?" The code was worse than the complaint:

| entry point | what it did |
|---|---|
| `Add` button | `openSettings('workspaces')` |
| `Remove` button | a confirm dialog — or a toast pointing at Settings when the lookup missed |
| `Ctrl+N` | `openSettings('workspaces')` |

Meanwhile the folder picker was three lines inside `WorkspaceManager`. So every entry point that wanted a picker opened a modal containing a button that opened the picker. In `App`:

```ts
	// the picker is three lines; every door to it used to open a settings
	// panel with a button that opened the picker
	const pickWorkspaceFolder = () => {
		openDialog({ directory: true })
			.then(picked => {
				if (typeof picked === 'string') handleAddWorkspace(picked);
			})
			.catch(e => toast(showError(e)));
	};
```

`Ctrl+N` fires it, and it gets a `+` in the title bar beside a refresh button — both `ghost` Buttons at `w-7 h-7`. Neither is a launch action, and the title bar already hosts exactly this class of control: the WSL chip, the runtime badge, the gear. That leaves the row below to do one job.

> `✅UI: add and refresh in the title bar`

Removal moves to where workspaces actually live. The tree renders workspace rows and had **no context menu** — `buildMenu` is project-only. `ContextMenu` is deliberately dumb and is already opened from two call sites (the project menu and the scripts menu), so this is a third list of items, not a third menu. `ProjectTreeProps` gains `onWorkspaceContextMenu?: (workspace: string, x: number, y: number) => void`, the header row gains an `onContextMenu` that calls it, and `App` builds the list:

```ts
	// acts on the row that was right-clicked, never on indexOf(selected
	// .workspace): that indirection is what made Delete fall through when the
	// lookup missed
	const buildWorkspaceMenu = (ws: string): MenuEntry[] => [
		{
			label: 'Refresh this workspace',
			hint: prettyKeys(shortcutFor('refresh')),
			onClick: handleRefresh
		},
		{
			label: 'Reveal in Explorer',
			onClick: () =>
				invoke('reveal_in_explorer', { path: ws }).catch(e =>
					toast(showError(e))
				)
		},
		'separator',
		{
			label: `Remove ${lastSegment(ws)}`,
			hint: prettyKeys(shortcutFor('removeWorkspace')),
			danger: true,
			onClick: () => {
				const idx = workspaces.indexOf(ws);
				if (idx >= 0) setRemoveIndex(idx);
				else toast(`${lastSegment(ws)} is no longer in the list`, 'error');
			}
		}
	];
```

wired through the same `setScriptMenu` the scripts menu uses. The Settings panel stays: it is the only surface that lists every workspace including ones with no visible projects, and import/export needs it. The tree becomes the *primary* surface; Settings stops being the *only* one.

> `✅UI: workspace context menu`

## 25.6 — A split button, and why it lasted sixty seconds

The reasoning went like this, and it is worth following because it is *good* reasoning that produced the wrong answer. Four editors could mean four more buttons; the row already held six; nine would not fit; the row would change shape every time you registered a target. A split button keeps it at three controls forever: the main half launches the default, the chevron opens the rest. It was built, it worked, and it was rejected the moment it appeared on screen: *"the buttons are just too awkward bro. I'd prefer to see everything instead of a dropdown and those big buttons."*

Every premise was true and the conclusion was still wrong. It solved "N buttons will not fit", which is true at twenty targets and false at six; a launcher has three to six. And the crowding it economised against had already been removed one section earlier when the row got the whole window. A layout decision made from a description is a hypothesis, and hypotheses about how something feels have a short half-life against the real screen. The split button was deleted the same hour it was written.

What shipped is unremarkable, which is the point. `Button` gains a tenth variant:

```ts
	// A launch target on the row; the default says so with aria-current.
	target:
		'gap-1.5 px-3 py-1.5 text-xs border border-border-strong bg-bg-panel text-text-secondary hover:not-disabled:text-text-primary hover:not-disabled:border-accent aria-[current=true]:border-accent aria-[current=true]:bg-bg-hover/40 aria-[current=true]:text-text-primary',
```

and `ActionButtons` becomes two groups and two buttons:

```tsx
// every target visible, none behind a chevron. a split button was built
// first and rejected on sight: a launcher has three to six targets, and
// hiding four behind a dropdown saves space the row already has
const TargetGroup = ({
	label,
	items,
	defaultId,
	isWsl,
	hasSelection,
	shortcut,
	onPick
}: TargetGroupProps) => (
	<div className='flex items-center gap-1.5 min-w-0'>
		<span className='text-[10px] uppercase tracking-wider text-text-muted shrink-0'>
			{label}
		</span>
		{items.map(t => {
			// the same fact TargetManager shows as a badge, before the click
			const blocked = isWsl && !t.wsl_args_template;
			const isDefault = t.id === defaultId;
			const title = blocked
				? `${t.name} has no WSL configuration, so it cannot open this project`
				: isDefault
					? `${t.name} — ${shortcut}`
					: t.name;
			return (
				<Button
					key={t.id}
					variant='target'
					className='shrink-0'
					aria-current={isDefault ? 'true' : undefined}
					disabled={!hasSelection || blocked}
					// the default launches with no id, so the Rust fallback chain
					// stays the one place that decides what default means
					onClick={() => onPick(isDefault ? undefined : t.id)}
					title={title}
				>
					<span className='truncate leading-none'>{t.name}</span>
					{isDefault && <Kbd>{shortcut}</Kbd>}
				</Button>
			);
		})}
	</div>
);
```

`ActionButtons` maps a two-entry `groups` array (*Edit* over `editors` with `defaults.editor` and the `openEditor` chord; *Terminal* likewise) into `TargetGroup`s, then *Open Both* as a `target` Button with its `Kbd`, then *Manage…* as a `ghost` that opens Settings on the targets panel. The container is `flex flex-wrap … justify-center gap-x-5 gap-y-2`: with enough targets a second line stays readable; a horizontal scrollbar in a launcher does not. Small dense buttons, all of them, grouped by kind. The default in each group is accent-bordered and carries the keyboard hint, because that is exactly what the key does. A target that cannot open the current selection is disabled with a title that says why — visible and refusing beats absent and mysterious.

`ActionButtonsProps` changes shape (`selectionIsWsl`, `editors`, `terminals`, `defaults`, `onEditor(targetId?)`, `onTerminal(targetId?)`, `onBoth`, `onManageTargets`); `App` computes `selectionIsWsl = selected?.file_system === 'WSL'` and its `handleOpenEditor` / `handleOpenTerminal` take the optional id. The keyboard chords call them with none.

> `✅UI: every target on the row`

The palette gets one command per target, appended after the settings entries the way chapter 16's dynamic entries already are:

```ts
			...targets.editors.map(t => ({
				id: `open.editor.${t.id}`,
				title: `Open in ${t.name}`,
				subtitle: p?.name ?? 'Select a project first',
				keywords: ['editor', 'open', t.name.toLowerCase()],
				disabled: !p || (selectionIsWsl && !t.wsl_args_template),
				run: () => handleOpenEditor(t.id)
			})),
```

and `Open terminal: …` likewise. What does **not** happen is adding these to `SHORTCUTS`. That table is a fixed list of ids consumed in three places; N dynamic editors do not fit a static table, and the palette is the right surface for "the one I want this time".

> `✅UI: open in any editor from the palette`

Last, chapter 23's `max-w-[1400px]` on the whole column was too blunt. The project list is a *table* — four columns of paths and badges — and a table wants the window; capping it stranded it in the middle of a 2560px screen with 580px of dead space either side. What actually read badly stretched was the single-line search input, so that caps alone at `max-w-[1100px] mx-auto`, the column goes to `px-6 py-5`, and the list gets the width. The row centres itself.

> `✅UI: the list gets the width`

## 25.7 — Verify

```powershell
cd src-tauri
cargo test
cd ..
```

`cargo test` reports **78** — chapter 24's 72 plus six for the rects. Then, with the four config files backed up:

**The row.** `bun tauri dev`: the list spans the window, the search box is 1100px centred, the title bar has `+` and ↻ beside the gear, and the row reads *EDIT* VS Code `Ctrl+⏎` · *TERMINAL* Windows Terminal `Shift+⏎` · Open Both `Alt+⏎` · Manage…. *Manage…* opens Settings on Editors & Terminals; *Scan*, *Add* on Zed, `Escape`: Zed is on the row **without a reload** — and, if `prefs.json` names it as the default editor, it is the one wearing the chord now. Click *VS Code* (not the default) with a project selected: VS Code opens that folder; close it.

**Refusal before the click.** Select a WSL project: the *Zed* button is disabled and its title reads *Zed has no WSL configuration, so it cannot open this project*; VS Code and Windows Terminal stay enabled. `Ctrl+Shift+P`, type `open in`: *Open in VS Code*, *Open in Zed*, *Open terminal: Windows Terminal*, each with the selected project as subtitle.

**Workspaces.** Right-click the `projects` header: *Refresh this workspace `F5`*, *Reveal in Explorer*, *Remove projects `Del`*. *Reveal* opens Explorer on `G:\projects` (close it). *Remove* opens the same confirm dialog `Delete` does; `Escape`. Click `+` in the title bar: the native folder picker, no Settings in between; cancel it.

**Minimize.** Read `window_state` from `prefs.json`, click the title bar's minimize button, read it again: unchanged — Win32 reports the window at `-32000,-32000 160×28`, `IsZoomed` false, `IsWindowVisible` **true**, and none of that was saved. Restore it from the taskbar: still maximized, prefs still unchanged.

Restore the four files when done.

> `✅STAGE: 25 launch-surface`; ff-merge; push.

---

## What you built

```
src-tauri/
  src/services/preferences.rs   MonitorRect; covers_a_monitor, is_restorable; 6 tests
  src/lib.rs                    minimize guard; artefact guard; unshowable rect → maximize
  src/commands.rs               open_both(editor_id, terminal_id); reveal_in_explorer(path)
  src/tray.rs                   None, None
src/
  types.d.ts                    run templates on LaunchTarget; TargetRegistry; KbdProps; TargetGroupProps; ActionButtonsProps
  hooks/useLaunchActions.ts     targetId through to the commands
  hooks/useTargets.ts           returns TargetRegistry
  components/Kbd.tsx            the one chip
  components/Button.tsx         target variant (aria-current)
  components/ActionButtons.tsx  TargetGroup × 2, Open Both, Manage…
  components/TargetManager.tsx  RUN_FIELDS for terminals
  components/ProjectTree.tsx    onWorkspaceContextMenu
  components/Settings.tsx       takes targets
  App.tsx                       one registry; pickWorkspaceFolder; buildWorkspaceMenu; per-target palette commands; the list gets the width
```

Any registered editor or terminal, from the row, the command palette or a right-click. *Open Both* takes a pair. Workspaces are added with a picker and removed from the row you clicked. The keyboard hints are one component. And a minimized window, a mid-maximize resize, or an unplugged monitor can no longer put DevGo somewhere you cannot see it.

> **The thread running through this chapter.** The parameter had been there since chapter 13. The picker was three lines away. The registry existed; it was just fetched twice. Three of the four workspace entry points were a button whose whole behaviour was opening a settings panel. **The capability usually exists; the wiring is the feature** — and the two window-state bugs are the same lesson from the other side: every gate was green, and nobody had minimized the app.
