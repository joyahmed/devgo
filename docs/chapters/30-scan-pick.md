# 30 — Scan for Folders, Check the Ones You Want (post-plan)

**Branch:** `30.scan-pick` — `git checkout 30.scan-pick` gives you this chapter's finished app; `git diff 29.taskbar 30.scan-pick` is exactly what this chapter adds.

**Starting from:** chapter 29 — a finished launcher with a taskbar icon that stays put, and a first-run screen that can *scan for project folders*. Once you have a single workspace, that scan is unreachable: the only button that runs it lives on the empty-state screen, and the empty state is gone the moment you add anything.

**Goal:** scan from anywhere — the title bar's `+` → *Scan for folders…* — see what was found with a checkbox on each, and add the checked ones in one go.

> **Hold on to:**
> 1. **Where a feature is mounted is part of the feature.** `discover_roots` was a working, tested command that the app could not reach from its normal state for thirteen chapters, because its only host component renders in a state the app leaves for good.
> 2. **Reuse the component, not the pattern.** One `ScanPicker` in two hosts cannot drift; two lists that look alike will.
> 3. **Show "already added", do not hide it.** An absence is not information; a disabled row with a tag is.
> 4. **The second modal is when the frame becomes a component.** Not the first — one is fine inline — and not the third, by which time they have diverged.
>
> TypeScript: a component whose mount *is* the request (the effect body is one promise chain, and the state writes live in `.then`); `Set<string>` state updated through `prev =>` copies; a `children`-taking frame with a `width` prop; `e.currentTarget.getBoundingClientRect()` to anchor a menu under its button. Rust: nothing — the backend needed no change.

> Chapter 17 shipped discovery and put it exactly where a first-time user needs it. It never asked where a *second-time* user would look, and the answer was nowhere. **A feature reachable from one screen is a feature most users never see.** The fix here writes almost no new capability — `discover_roots` and `add_workspace_folders(paths)` both existed — it moves a door.

---

## 30.1 — Where the scan actually lived

`Onboarding.tsx` held the whole thing: a *Scan for projects* button, the `invoke('discover_roots')`, the list of roots, and one **Add** button per root plus an **Add all**. Read the component's mount condition in `App.tsx` and the problem is one line:

```tsx
{workspaces.length === 0 && !loading ? (
	<Onboarding … />
) : (
	…
```

`Onboarding` renders only while there are no workspaces. Every capability inside it inherits that condition. The scan was not broken; it was *scoped* to a state the app leaves and never returns to.

The backend needed nothing. `discover_roots` (`commands.rs`) probes the common roots on Windows and inside **running** distros only — never a stopped one, because probing `\\wsl.localhost\` boots the VM, the Core Rule from chapter 06. `add_workspace_folders(paths)` already takes a list and reports the ones it refused rather than discarding the rest of the drop. The picker is UI.

## 30.2 — The frame comes out of the dialog

`ConfirmDialog` was the app's only modal: backdrop, centred panel, Escape to close, a message and two buttons — all in one component. The scan picker is about to be the second modal, and two hand-rolled frames drift (one gets its Escape handler fixed, the other does not). So before the picker exists, the frame moves out into `components/Modal.tsx`:

```tsx
const Modal = ({
	open,
	title,
	onClose,
	children,
	width = 'w-[min(460px,92vw)]'
}: ModalProps) => {
	// runs unconditionally (hooks cannot sit behind the early return) and
	// only wires the listener while open
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			className='fixed inset-0 bg-black/60 flex items-center justify-center z-50'
			onClick={onClose}
		>
			<div
				className={`bg-bg-secondary border border-border rounded-xl p-6 ${width} shadow-2xl`}
				onClick={e => e.stopPropagation()}
			>
				<h3 className='text-base font-bold mb-2'>{title}</h3>
				{children}
			</div>
		</div>
	);
};
```

`ModalProps` goes in `types.d.ts` beside `ConfirmDialogProps` (`children: React.ReactNode`, `width?: string` — the confirm dialog is a sentence and two buttons; a list wants more). `ConfirmDialog` becomes its message and its mapped `actions` inside `<Modal {...{ open, title, onClose: onCancel }}>` — no `useEffect`, no early return, the Escape rule lives once. Both dialogs in `App.tsx` (*Stop WSL*, *Remove Workspace*) are untouched: same props, same behaviour, one frame fewer.

> `✅UI: modal frame out of the confirm dialog`

## 30.3 — One picker

The list moves out of `Onboarding` into `components/ScanPicker.tsx`, so the empty screen and the populated app will render one component and cannot drift. Its props (`ScanPickerProps`, in `types.d.ts`): `existing` — the current workspace list; `onAddMany`; `onError`; and an optional `onDone`, fired after a successful add so a modal host can close itself. The state block:

```tsx
	const [roots, setRoots] = useState<DiscoveredRoot[] | null>(null);
	// true from the first frame: "found 0" before the scan has run is a lie
	const [scanning, setScanning] = useState(true);
	const [picked, setPicked] = useState<Set<string>>(new Set());
```

Three decisions in it:

- **`scanning` starts `true`.** The scan begins as the picker mounts, and a first frame that says *Found 0* before anything has run is a lie the user reads.
- **Mounting is the request.** The Core Rule says discovery is something the user asks for, not something that fires on its own. Both doors — the *Scan for projects* button on the empty screen and *Scan for folders…* in the `+` menu — are the user choosing to mount this. Nothing scans on launch.
- **Everything new starts checked.** After a scan the common answer is "yes, all of those"; unchecking two is less work than checking six.

The shape of the request keeps the effect body to a promise chain and puts every state write in `.then` — the setState-in-effect cascade the lint rule (which this repo does not run, and does not need to) exists for:

```tsx
	// the one place a finished scan touches state, shared by the mount scan
	// and Rescan so the two cannot disagree about what "found" means
	const applyFound = (found: DiscoveredRoot[]) => {
		setRoots(found);
		// everything new starts checked: after a scan the answer is usually
		// "yes, all of those", and unchecking two beats checking six
		setPicked(new Set(found.filter(r => !isAdded(r)).map(r => r.path)));
	};

	const request = () =>
		invoke<DiscoveredRoot[]>('discover_roots')
			.then(applyFound)
			.catch(e => {
				onError(String(e));
				setRoots([]);
			})
			.finally(() => setScanning(false));

	// the effect body is the request and nothing else; scanning is already
	// true, so no state is written synchronously in here
	useEffect(() => {
		request();
	}, []);

	const rescan = () => {
		setScanning(true);
		request();
	};
```

**Already added is shown, not hidden.** `existing` is the workspace list, and a root that is already in it renders **checked and disabled** with an `added` tag rather than being filtered out. `isAdded` compares through `normalizePath`, a new export in `paths.ts` beside `lastSegment`:

```ts
// the comparison the workspace store makes before refusing a duplicate
// (paths::normalize): forward slashes, no trailing separator, case kept.
// a root the store would refuse has to read as already added, or the
// picker offers something the add then rejects
export const normalizePath = (path: string) =>
	path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
```

That is exactly the comparison `WorkspaceStore::add` makes (`paths::normalize` in `platform/paths.rs`) — and *exactly* matters. Had the picker also lowercased, a `g:\dev` beside a `G:\Dev` would read as *added* in the picker and still be accepted as a second workspace by the store, which does not case-fold. The picker mirrors the store; if the store ever learns to case-fold, this is the one other place to change. Hiding the added ones was the tempting alternative and it is wrong for a reason you only see on the second scan: a rescan that finds three roots after the first found five *looks like it found less*, and nobody reads "two are already added" out of an absence. The header says it instead: *Found 2 · 1 already added*.

The render: *Scanning…* while `scanning`; the chapter 17 empty-state sentence when nothing was found; otherwise the header with a `ghost` *Check all* / *Uncheck all* (`allOn` is "every addable root is picked"), a `<ul>` of `<label>` rows — a real `<input type='checkbox'>` in each, disabled on an added row, the `WIN`/`WSL` tag replaced by `added` — capped at `max-h-[50vh]` with its own scroll, and a footer with **Rescan** as a real `secondary` Button (starting a distro and scanning again is the second most likely thing to do here, and a muted link in the corner said it was not) and a `primary` **Add 1 folder** / **Add N folders** disabled at zero. `KIND_TONE` moves here from `Onboarding` with the list.

> `✅UI: scan picker with checkboxes`

`Onboarding` loses `roots`, `scanning`, `scan`, the `invoke` import and the whole list, and gains one boolean: `showScan`. *Scan for projects* sets it and disables itself; under the buttons, `{showScan && <ScanPicker {...{ existing: [], onAddMany, onError }} />}`. `existing` is empty by construction — there are no workspaces on this screen. `onAdd` and the folder picker stay as they were.

> `✅UI: onboarding renders the picker`

## 30.4 — The button becomes a door

The title bar's `+` used to *be* the folder picker. Now it opens a two-entry menu anchored under itself, through the `ContextMenu` primitive that already serves the project menu, the workspace menu and the script menu:

```tsx
						onClick={e => {
							const r = e.currentTarget.getBoundingClientRect();
							setAddMenu({ x: r.left, y: r.bottom + 4 });
						}}
```

```tsx
			{addMenu && (
				<ContextMenu
					{...{
						x: addMenu.x,
						y: addMenu.y,
						items: [
							{
								label: 'Choose a folder…',
								hint: prettyKeys(shortcutFor('addWorkspace')),
								onClick: pickWorkspaceFolder
							},
							{ label: 'Scan for folders…', onClick: () => setScanOpen(true) }
						],
						onClose: () => setAddMenu(null)
					}}
				/>
			)}
```

The folder picker keeps its `Ctrl+N` — the shortcut still calls `pickWorkspaceFolder` directly — shown as the menu hint the way every other menu shows its keys. The scan opens in the new frame, after the `+` menu and before the two confirm dialogs:

```tsx
			<Modal
				{...{
					open: scanOpen,
					title: 'Scan for folders',
					onClose: () => setScanOpen(false),
					width: 'w-[min(640px,92vw)]'
				}}
			>
				<ScanPicker
					{...{
						existing: workspaces,
						onAddMany: handleAddMany,
						onError: (m: string) => toast(m, 'error'),
						onDone: () => setScanOpen(false)
					}}
				/>
			</Modal>
```

`Modal` returns `null` while closed, so the picker is unmounted between openings and every *Scan for folders…* mounts a fresh one — which is the request. (No second `{scanOpen && …}` around the picker: the frame already does that.)

> `✅UI: the add button is a door`

## 30.5 — Verify

`tsc -b` and `bun run build` are the gates — `cargo test` still reports **118**, nothing Rust changed. Then, with the config files backed up and `workspaces.json` set to `[]` so the empty screen shows:

**The first door.** `bun tauri dev`: *Welcome to DevGo*. *Scan for projects*: the button disables and *Scanning…* shows in the same frame — no *Found 0* flash. With the distro stopped the scan finds the Windows roots only, *Found 2* here (`~\projects`, `C:\dev`), both checked, *Uncheck all*, *Add 2 folders*. Uncheck one: *Check all*, *Add 1 folder*. Click it: the tree appears with the one workspace, and `workspaces.json` holds it.

**The second door.** `+`: a menu with *Choose a folder… Ctrl+N* and *Scan for folders…*. The second: the menu closes, a *Scan for folders* modal opens, and the picker reads *Found 2 · 1 already added* — the workspace you just added is checked, disabled and tagged `added`; the other is checked and live; *Add 1 folder*. `Escape` closes the modal. Open it again, *Rescan* (*Scanning…* again, same two), *Add 1 folder*: the modal closes itself through `onDone`, the tree gains the second workspace, `workspaces.json` holds both.

**The old dialog in the new frame.** Right-click the new workspace's row → *Remove*: *Remove Workspace* with *Cancel* / *Remove* — chapter 12's `confirmLabel` intact — and `Escape` closes it with nothing removed.

Restore the files.

> `✅STAGE: 30 scan-pick`; ff-merge; push.

---

## What you built

```
src/
  components/Modal.tsx          the one frame: backdrop, panel, title, Escape; width prop
  components/ConfirmDialog.tsx  message + actions inside Modal
  components/ScanPicker.tsx     scan on mount, checkboxes, added rows shown, Rescan, Add N
  components/Onboarding.tsx     showScan → ScanPicker
  paths.ts                      normalizePath, the store's comparison
  App.tsx                       + opens a menu; Scan for folders… opens the picker in a Modal
  types.d.ts                    ModalProps, ScanPickerProps
```

Scanning for project folders is reachable from the `+` menu at any time, the results are a checkbox list with already-added roots shown as such, and one button adds the checked ones.

> **The thread running through this chapter.** No new capability was written; a working one was moved to where a second-time user would look for it. **Where a feature is mounted is part of the feature** — and the moment a second modal needed the first one's frame was the moment the frame became a component.
