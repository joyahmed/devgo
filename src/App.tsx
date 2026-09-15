import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import ActionButtons from './components/ActionButtons';
import Button from './components/Button';
import CommandPalette from './components/CommandPalette';
import ConfirmDialog from './components/ConfirmDialog';
import ContextMenu from './components/ContextMenu';
import Onboarding from './components/Onboarding';
import ProjectTree from './components/ProjectTree';
import RuntimeIndicator from './components/RuntimeIndicator';
import SearchBox from './components/SearchBox';
import StatusBar from './components/StatusBar';
import TitleBar from './components/TitleBar';
import WslControl from './components/WslControl';
import ToastProvider, { useToast } from './components/Toast';
import { useLaunchActions } from './hooks/useLaunchActions';
import { useMaximized } from './hooks/useMaximized';
import { useProjects } from './hooks/useProjects';
import { useRuntime } from './hooks/useRuntime';
import { useWorkspaces } from './hooks/useWorkspaces';
import { isTypingTarget, matches, prettyKeys, shortcutFor } from './shortcuts';

// Settings pulls in WorkspaceManager and the shortcut table, none of which the
// launcher needs to start. The split used to sit on WorkspaceManager; now that
// Settings imports it, the split moves up to Settings or it silently vanishes.
const Settings = lazy(() => import('./components/Settings'));

const showError = (e: unknown): string => {
	if (typeof e === 'string') return e;
	if (e && typeof e === 'object') {
		const obj = e as Record<string, unknown>;
		for (const key of Object.keys(obj)) {
			const val = obj[key];
			if (typeof val === 'string') return val;
			if (val && typeof val === 'object') return showError(val);
		}
	}
	return 'Something went wrong';
};

const AppInner = () => {
	const runtime = useRuntime();
	const maximized = useMaximized();
	const { workspaces, refresh: refreshWorkspaces } = useWorkspaces();
	const {
		filtered,
		query,
		setQuery,
		selected,
		setSelected,
		refresh,
		loading,
		workspaceStates,
		ranks,
		git,
		tech,
		pinnedProjects,
		sortMode,
		toggleSort,
		togglePin
	} = useProjects();
	const { addWorkspace, removeWorkspace, openEditor, openTerminal, openBoth } =
		useLaunchActions(selected, refresh);
	const { toast } = useToast();
	const [removeIndex, setRemoveIndex] = useState<number | null>(null);

	// Read once, on mount. The literal is only what the Shortcuts panel shows
	// for the frame before the command answers; prefs.json is the value.
	const [summonHotkey, setSummonHotkey] = useState('Ctrl+Alt+Space');
	const loadHotkey = () =>
		invoke<string>('get_summon_hotkey').then(setSummonHotkey).catch(() => {});
	useEffect(() => {
		loadHotkey();
	}, []);

	// Live WSL state, refreshed on the passes the app already makes — every
	// scan, and every stop attempt — never on a timer. `wsl -l -q --running`
	// boots nothing, so it is free to ask.
	const [distros, setDistros] = useState<string[]>([]);
	const refreshDistros = () => {
		invoke<string[]>('get_running_distros').then(setDistros).catch(() => {});
	};
	useEffect(refreshDistros, [workspaceStates]);

	// One dialog, two destructive actions with two different sentences: the
	// popover asks App to confirm, and App renders the question.
	const [confirmAction, setConfirmAction] = useState<{
		message: string;
		run: () => void;
	} | null>(null);

	const treeRef = useRef<ProjectTreeHandle>(null);
	const handleArrow = (dir: 1 | -1) => treeRef.current?.navigate(dir);

	// Summoned by the global hotkey: put the caret in the search box and clear
	// whatever was left over, so the window is always ready to be typed into.
	const searchRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		const unlisten = listen('devgo://summoned', () => {
			setQuery('');
			searchRef.current?.focus();
			searchRef.current?.select();
		});
		return () => {
			unlisten.then(f => f()).catch(() => {});
		};
	}, []);

	// The search box keeps focus under the dialog's backdrop, and its own
	// Escape handler would clear the query on the keystroke that closes the
	// dialog. So opening Settings takes focus away and closing it gives it back.
	const [showSettings, setShowSettings] = useState(false);
	const [settingsPanel, setSettingsPanel] = useState<string | undefined>();
	const openSettings = (panel?: string) => {
		searchRef.current?.blur();
		setSettingsPanel(panel);
		setShowSettings(true);
	};
	const closeSettings = () => {
		setShowSettings(false);
		setSettingsPanel(undefined);
		searchRef.current?.focus();
	};

	const handleSelect = (p: Project) => setSelected(p);

	const handleLaunch = (p: Project) => {
		setSelected(p);
		openBoth(p).catch(e => toast(showError(e)));
	};

	const handleSearchEnter = () => {
		const target = selected ?? filtered[0];
		if (target) handleLaunch(target);
	};

	// useLaunchActions refreshes projects only; the workspace list is a second
	// view of the same state and goes stale without this
	const handleAddWorkspace = async (path: string) => {
		try {
			await addWorkspace(path);
		} catch (e) {
			toast(showError(e));
		}
		refreshWorkspaces();
	};

	const handleAddMany = async (paths: string[]) => {
		try {
			await invoke('add_workspace_folders', { paths });
		} catch (e) {
			toast(showError(e));
		}
		refreshWorkspaces();
		refresh();
	};

	// tauri owns file drag-drop, so this is the webview event, not html5
	const [dragOver, setDragOver] = useState(false);
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		getCurrentWebview()
			.onDragDropEvent(event => {
				const p = event.payload;
				if (p.type === 'enter' || p.type === 'over') setDragOver(true);
				else if (p.type === 'leave') setDragOver(false);
				else if (p.type === 'drop') {
					setDragOver(false);
					if (p.paths.length) handleAddMany(p.paths);
				}
			})
			.then(f => {
				unlisten = f;
			})
			.catch(() => {});
		return () => unlisten?.();
	}, []);

	const handleRemove = async (index: number) => {
		try {
			await removeWorkspace(index);
		} catch (e) {
			toast(showError(e));
		}
		refreshWorkspaces();
	};

	// A forced refresh is the one path allowed to start a stopped WSL distro.
	const handleRefresh = () => {
		refresh(true).catch(e => toast(showError(e)));
	};

	// Report workspaces we could not read, but stay quiet about a stopped distro
	// — that is DevGo working as intended, not a failure worth interrupting for.
	const reported = useRef<string>('');
	useEffect(() => {
		const degraded = workspaceStates.filter(
			s => s.status !== 'live' && s.reason !== 'distro_stopped'
		);
		const key = degraded.map(s => `${s.workspace}:${s.status}`).join('|');
		if (!key || key === reported.current) {
			reported.current = key;
			return;
		}
		reported.current = key;
		const names = degraded.map(s => s.workspace).join(', ');
		const allCached = degraded.every(s => s.status === 'cached');
		toast(
			allCached
				? `Showing cached projects for ${names}`
				: `Could not read ${names}`,
			allCached ? 'info' : 'error'
		);
	}, [workspaceStates]);

	const handleTogglePin = (p: Project) => {
		togglePin(p).catch(e => toast(showError(e)));
	};

	const handleOpenRemote = (p: Project) => {
		invoke('open_remote', { fullPath: p.full_path }).catch(e =>
			toast(showError(e))
		);
	};

	const handleOpenEditor = () => openEditor().catch(e => toast(showError(e)));
	const handleOpenTerminal = () =>
		openTerminal().catch(e => toast(showError(e)));
	const handleOpenBoth = () => openBoth().catch(e => toast(showError(e)));

	const revealInExplorer = (p: Project) => {
		invoke('reveal_in_explorer', { project: p }).catch(e =>
			toast(showError(e))
		);
	};

	// secure context + user gesture, so no clipboard plugin needed
	const copyText = async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast(`Copied ${label}`, 'success');
		} catch {
			toast('Could not copy to clipboard', 'error');
		}
	};

	const copyWindowsPath = (p: Project) => copyText(p.full_path, 'Windows path');

	const copyWslPath = async (p: Project) => {
		try {
			const wsl = await invoke<string>('get_wsl_path', { project: p });
			await copyText(wsl, 'WSL path');
		} catch (e) {
			toast(showError(e));
		}
	};

	// every run is a handler that already exists; the palette only finds them
	const [paletteOpen, setPaletteOpen] = useState(false);
	const buildCommands = (): PaletteCommand[] => {
		const hint = (id: ShortcutId) => prettyKeys(shortcutFor(id));
		const p = selected;
		// project actions are disabled, not hidden, so they stay discoverable
		const proj = (
			id: ShortcutId,
			title: string,
			keywords: string[],
			act: (p: Project) => void
		): PaletteCommand => ({
			id,
			title,
			hint: hint(id),
			subtitle: p?.name ?? 'Select a project first',
			keywords,
			disabled: !p,
			run: () => p && act(p)
		});

		const commands: PaletteCommand[] = [
			{
				id: 'refresh',
				title: 'Refresh projects',
				hint: hint('refresh'),
				keywords: ['rescan', 'reload'],
				run: handleRefresh
			},
			{
				id: 'settings',
				title: 'Open Settings',
				hint: hint('settings'),
				keywords: ['preferences', 'config'],
				run: () => openSettings()
			},
			{
				id: 'settings.workspaces',
				title: 'Settings: Workspaces',
				subtitle: 'Add or remove workspace folders',
				keywords: ['add', 'remove', 'folder'],
				run: () => openSettings('workspaces')
			},
			{
				id: 'settings.targets',
				title: 'Settings: Editors & Terminals',
				keywords: ['editor', 'terminal', 'vscode'],
				run: () => openSettings('targets')
			},
			{
				id: 'settings.shortcuts',
				title: 'Settings: Shortcuts',
				keywords: ['keybindings', 'keys', 'hotkey'],
				run: () => openSettings('shortcuts')
			},
			{
				id: 'sort',
				title: `Sort order: ${sortMode} (cycle)`,
				keywords: ['order', 'frecency', 'activity', 'name'],
				run: toggleSort
			},
			proj('openEditor', 'Open in editor', ['code', 'edit'], pr =>
				openEditor(pr).catch(e => toast(showError(e)))
			),
			proj('openTerminal', 'Open terminal', ['term', 'shell', 'wt'], pr =>
				openTerminal(pr).catch(e => toast(showError(e)))
			),
			proj('openBoth', 'Open both', ['launch'], handleLaunch),
			proj(
				'revealExplorer',
				'Reveal in Explorer',
				['folder', 'files'],
				revealInExplorer
			),
			proj('copyWinPath', 'Copy Windows path', ['path', 'clipboard'], copyWindowsPath),
			proj('copyWslPath', 'Copy WSL path', ['path', 'linux'], copyWslPath),
			proj(
				'togglePin',
				p && ranks.get(p.full_path)?.pinned ? 'Unpin project' : 'Pin project',
				['favorite', 'star'],
				handleTogglePin
			),
			{
				id: 'quit',
				title: 'Quit DevGo',
				hint: hint('quit'),
				keywords: ['exit', 'close'],
				run: () => invoke('quit_app').catch(() => {})
			}
		];

		// present only when they apply; nothing to teach by showing them otherwise
		if (p && git.get(p.full_path)?.remote) {
			commands.push({
				id: 'openRemote',
				title: 'Open remote in browser',
				subtitle: p.name,
				keywords: ['git', 'github', 'url'],
				run: () => handleOpenRemote(p)
			});
		}
		if (distros.length > 0) {
			commands.push({
				id: 'wsl.shutdown',
				title: 'Shut down all WSL',
				subtitle: distros.join(', '),
				keywords: ['wsl', 'stop', 'kill'],
				run: () =>
					setConfirmAction({
						message:
							'Shut down all of WSL? This stops every distro and the virtual machine itself, including Docker Desktop on the WSL2 backend.',
						run: () =>
							invoke<string>('shutdown_wsl')
								.then(m => toast(m, 'success'))
								.catch(e => toast(showError(e), 'error'))
								.finally(refreshDistros)
					})
			});
		}

		return commands;
	};

	// hints come from the shortcut table so the menu can't lie about the keys
	const [menu, setMenu] = useState<{
		project: Project;
		x: number;
		y: number;
	} | null>(null);
	// one package.json, read when you ask: never per row, never in the scan
	const [scriptMenu, setScriptMenu] = useState<{
		x: number;
		y: number;
		items: MenuEntry[];
	} | null>(null);
	const openScripts = async (p: Project, x: number, y: number) => {
		try {
			const scripts = await invoke<DevScript[]>('get_project_scripts', {
				project: p
			});
			if (scripts.length === 0) {
				toast('No dev scripts found for this project', 'info');
				return;
			}
			setScriptMenu({
				x,
				y,
				items: scripts.map(s => ({
					label: s.name,
					hint: s.command,
					onClick: () =>
						invoke('run_script', { project: p, command: s.command }).catch(
							e => toast(showError(e), 'error')
						)
				}))
			});
		} catch (e) {
			toast(showError(e), 'error');
		}
	};

	const buildMenu = (p: Project): MenuEntry[] => {
		const hint = (id: ShortcutId) => prettyKeys(shortcutFor(id));
		const remote = git.get(p.full_path)?.remote;
		const pinned = ranks.get(p.full_path)?.pinned ?? false;
		return [
			{
				label: 'Open in editor',
				hint: hint('openEditor'),
				onClick: () => openEditor(p).catch(e => toast(showError(e)))
			},
			{
				label: 'Open terminal',
				hint: hint('openTerminal'),
				onClick: () => openTerminal(p).catch(e => toast(showError(e)))
			},
			{ label: 'Open both', hint: hint('openBoth'), onClick: () => handleLaunch(p) },
			'separator',
			{
				label: 'Reveal in Explorer',
				hint: hint('revealExplorer'),
				onClick: () => revealInExplorer(p)
			},
			{
				label: 'Copy Windows path',
				hint: hint('copyWinPath'),
				onClick: () => copyWindowsPath(p)
			},
			{
				label: 'Copy WSL path',
				hint: hint('copyWslPath'),
				onClick: () => copyWslPath(p)
			},
			...(remote
				? [{ label: 'Open remote', onClick: () => handleOpenRemote(p) }]
				: []),
			'separator',
			{
				label: 'Run dev script…',
				onClick: () => openScripts(p, menu?.x ?? 240, menu?.y ?? 200)
			},
			'separator',
			{
				label: pinned ? 'Unpin' : 'Pin to top',
				hint: hint('togglePin'),
				onClick: () => handleTogglePin(p)
			}
		];
	};

	// Delete acts on the selected project's workspace. With no selection there
	// is nothing unambiguous to remove, so it opens Settings rather than guess.
	// a settings window appearing for no stated reason reads as the key
	// being broken
	const handleRemoveShortcut = () => {
		if (!selected) {
			toast('Select a project first — Delete removes its workspace', 'info');
			return;
		}
		const idx = workspaces.indexOf(selected.workspace);
		if (idx < 0) {
			toast(
				`Can't find the workspace for ${selected.name} — open Settings to remove it`,
				'error'
			);
			return;
		}
		setRemoveIndex(idx);
	};

	// One handler, driven by the declared shortcut table. Everything here is
	// either modified or a non-typing key, so it all survives search focus —
	// which is where the summon hotkey leaves you. The order is the table's:
	// the bindings that work with nothing selected, then the ones that need one.
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const fire = (id: ShortcutId, run: () => void) => {
				if (!matches(e, shortcutFor(id))) return false;
				e.preventDefault();
				run();
				return true;
			};

			if (fire('commandPalette', () => setPaletteOpen(true))) return;
			if (fire('focusSearch', () => searchRef.current?.select())) return;
			if (fire('clearSearch', () => setQuery(''))) return;
			if (fire('refresh', handleRefresh)) return;
			if (fire('settings', () => openSettings())) return;
			if (fire('quit', () => invoke('quit_app').catch(() => {}))) return;
			if (fire('addWorkspace', () => openSettings('workspaces'))) return;
			// Delete is the one bare typing key in the table: in the search box it
			// deletes a character, and that stays the search box's.
			if (!isTypingTarget(e) && fire('removeWorkspace', handleRemoveShortcut))
				return;

			// Ctrl+R is a second binding for refresh, kept because it is muscle
			// memory from the browser and costs nothing. The table maps one id to
			// one chord; an alias is written out here rather than widening the type.
			if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
				e.preventDefault();
				handleRefresh();
				return;
			}

			if (!selected) return;
			if (fire('openEditor', handleOpenEditor)) return;
			if (fire('openTerminal', handleOpenTerminal)) return;
			if (fire('openBoth', handleOpenBoth)) return;
			if (fire('revealExplorer', () => revealInExplorer(selected))) return;
			if (fire('copyWinPath', () => copyWindowsPath(selected))) return;
			if (fire('copyWslPath', () => copyWslPath(selected))) return;
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [selected, workspaces]);

	return (
		// the radius belongs to a floating window; flush with the screen it
		// only clips the app
		<div
			className={`flex flex-col h-screen w-screen overflow-hidden ${
				maximized ? '' : 'rounded-xl'
			}`}
		>
			<TitleBar>
				<div className='flex items-center gap-2'>
					<WslControl
						{...{
							distros,
							onChanged: refreshDistros,
							onConfirm: (message: string, run: () => void) =>
								setConfirmAction({ message, run }),
							onResult: toast
						}}
					/>
					<RuntimeIndicator runtime={runtime?.runtime ?? 'windows'} />
					<Button
						variant='ghost'
						onClick={() => openSettings()}
						title='Settings (Ctrl+,)'
					>
						<svg
							width='16'
							height='16'
							viewBox='0 0 24 24'
							fill='none'
							stroke='currentColor'
							strokeWidth='2'
							strokeLinecap='round'
							strokeLinejoin='round'
						>
							<circle cx='12' cy='12' r='3' />
							<path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' />
						</svg>
					</Button>
				</div>
			</TitleBar>

			<Suspense>
				<Settings
					{...{
						open: showSettings,
						onClose: closeSettings,
						workspaces,
						onAddWorkspace: handleAddWorkspace,
						onRemoveWorkspace: (i: number) => setRemoveIndex(i),
						summonHotkey,
						onError: (m: string) => toast(m, 'error'),
						panel: settingsPanel,
						onScanChanged: () => refresh(),
						// an import touches three stores; each has its own reader
						onImported: () => {
							refreshWorkspaces();
							refresh();
							loadHotkey();
						},
						onSummonChanged: setSummonHotkey
					}}
				/>
			</Suspense>

			{paletteOpen && (
				<CommandPalette
					{...{
						commands: buildCommands(),
						onClose: () => setPaletteOpen(false)
					}}
				/>
			)}

			{menu && (
				<ContextMenu
					{...{
						x: menu.x,
						y: menu.y,
						items: buildMenu(menu.project),
						onClose: () => setMenu(null)
					}}
				/>
			)}

			{scriptMenu && (
				<ContextMenu
					{...{
						x: scriptMenu.x,
						y: scriptMenu.y,
						items: scriptMenu.items,
						onClose: () => setScriptMenu(null)
					}}
				/>
			)}

			<ConfirmDialog
				{...{
					open: confirmAction !== null,
					title: 'Stop WSL',
					message: confirmAction?.message ?? '',
					confirmLabel: 'Stop',
					onConfirm: () => {
						confirmAction?.run();
						setConfirmAction(null);
					},
					onCancel: () => setConfirmAction(null)
				}}
			/>

			<ConfirmDialog
				{...{
					open: removeIndex !== null,
					title: 'Remove Workspace',
					message:
						'Are you sure you want to remove this workspace folder? Your files will not be deleted.',
					confirmLabel: 'Remove',
					onConfirm: () => {
						if (removeIndex !== null) handleRemove(removeIndex);
						setRemoveIndex(null);
					},
					onCancel: () => setRemoveIndex(null)
				}}
			/>

			{/* one cap for the search box, the action row and the rows, instead of
			    a width rule each */}
			<div className='flex-1 flex flex-col w-full max-w-[1400px] mx-auto p-5 gap-4 overflow-hidden'>
				{workspaces.length === 0 && !loading ? (
					<Onboarding
						{...{
							onAdd: handleAddWorkspace,
							onAddMany: handleAddMany,
							onError: (m: string) => toast(m, 'error')
						}}
					/>
				) : (
					<>
						<SearchBox
							{...{
								ref: searchRef,
								value: query,
								onChange: setQuery,
								onEnter: handleSearchEnter,
								onArrow: handleArrow,
								sortMode,
								onToggleSort: toggleSort,
								enterHint:
									selected || filtered.length > 0 ? '⏎ Enter' : undefined
							}}
						/>
						<ProjectTree
							{...{
								ref: treeRef,
								projects: filtered,
								selected,
								onSelect: handleSelect,
								onDoubleClick: handleLaunch,
								onLaunch: handleLaunch,
								query,
								loading,
								workspaceStates,
								ranks,
								gitInfo: git,
								techInfo: tech,
								pinnedProjects,
								onTogglePin: handleTogglePin,
								onOpenRemote: handleOpenRemote,
								onContextMenu: (p: Project, x: number, y: number) =>
									setMenu({ project: p, x, y })
							}}
						/>
						<ActionButtons
							{...{
								hasSelection: selected !== null,
								onAddWorkspace: () => openSettings('workspaces'),
								onRemoveWorkspace: handleRemoveShortcut,
								onEditor: handleOpenEditor,
								onTerminal: handleOpenTerminal,
								onBoth: handleOpenBoth,
								onRefresh: handleRefresh
							}}
						/>
					</>
				)}
			</div>

			{dragOver && (
				<div className='fixed inset-0 z-50 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent m-2 rounded-xl pointer-events-none'>
					<span className='text-lg font-semibold text-accent bg-bg-secondary/90 px-5 py-2.5 rounded-lg border border-accent'>
						Drop a folder to add a workspace
					</span>
				</div>
			)}

			<StatusBar {...{ onOpenPalette: () => setPaletteOpen(true) }} />
		</div>
	);
};

const App = () => {
	// The window is created hidden (tauri.conf.json) and shown once React has
	// painted, so a cold start never flashes a white rectangle.
	useEffect(() => {
		getCurrentWindow().show();
	}, []);

	return (
		<ToastProvider>
			<AppInner />
		</ToastProvider>
	);
};

export default App;
