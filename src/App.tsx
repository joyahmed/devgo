import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import AddRepo from './components/AddRepo';
import Button from './components/Button';
import ClonePicker from './components/ClonePicker';
import CommandPalette from './components/CommandPalette';
import ConfirmDialog from './components/ConfirmDialog';
import ContextMenu from './components/ContextMenu';
import Drawer from './components/Drawer';
import GithubControls from './components/GithubControls';
import NameDialog from './components/NameDialog';
import Onboarding from './components/Onboarding';
import ProjectTree from './components/ProjectTree';
import ScanPicker from './components/ScanPicker';
import SearchBox from './components/SearchBox';
import StatusBar from './components/StatusBar';
import TitleBar from './components/TitleBar';
import WslControl from './components/WslControl';
import ToastProvider, { useToast } from './components/Toast';
import { useClone } from './hooks/useClone';
import { useGithub } from './hooks/useGithub';
import { useLaunchActions } from './hooks/useLaunchActions';
import { useMaximized } from './hooks/useMaximized';
import { useProjects } from './hooks/useProjects';
import { useTargets } from './hooks/useTargets';
import { useWorkspaces } from './hooks/useWorkspaces';
import { lastSegment } from './paths';
import { isTypingTarget, matches, prettyKeys, shortcutFor } from './shortcuts';
import { applyTextScale, stepTextScale } from './textSize';
import { loadGroundAlpha } from './transparency';

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

// the host's own spelling for the four we know, the bare hostname for the
// rest: "Open repo on GitHub", not "on github" and not "on github.com"
const HOST_NAMES: Record<string, string> = {
	'github.com': 'GitHub',
	'gitlab.com': 'GitLab',
	'bitbucket.org': 'Bitbucket',
	'codeberg.org': 'Codeberg'
};
const hostOf = (url: string) => {
	const h = (url.replace(/^https?:\/\//, '').split('/')[0] ?? '').replace(
		/^www\./,
		''
	);
	return HOST_NAMES[h] ?? h;
};

// the sort control's three modes, in the palette's cycle order
const SORT_MODES: { mode: SortMode; label: string }[] = [
	{ mode: 'frecency', label: 'Frecency' },
	{ mode: 'activity', label: 'Activity' },
	{ mode: 'name', label: 'A–Z' }
];

const HINTS_KEY = 'devgo.hints';

const AppInner = () => {
	const maximized = useMaximized();
	const {
		workspaces,
		refresh: refreshWorkspaces,
		reorder: reorderWorkspaces
	} = useWorkspaces();
	const {
		projects,
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
		sessions,
		forgetSession,
		pinnedProjects,
		sortMode,
		toggleSort,
		setSort,
		togglePin
	} = useProjects();
	const { addWorkspace, removeWorkspace, openEditor, openTerminal, openBoth } =
		useLaunchActions(selected, refresh);
	// the github group. reads its cache on mount and re-reads after every
	// badge pass (git is the dependency) so the local marks track the disk.
	// its box is its own; the project query never reaches it
	const github = useGithub(git);
	// one registry: a second useTargets in Settings would leave the row stale
	// after an add until the next mount
	const targets = useTargets();
	const { toast } = useToast();
	const [removeIndex, setRemoveIndex] = useState<number | null>(null);
	// the + menu, anchored under its button, and the scan picker it opens.
	// two ways in, choose one folder or scan and tick several, and the
	// button is the door to both rather than a button per way
	const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(
		null
	);
	const [scanOpen, setScanOpen] = useState(false);

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

	// One dialog, three destructive actions with three different sentences:
	// the popover asks App to confirm, and App renders the question. the
	// title and the verb are the action's; the wsl ones were the only ones
	// until the session kill, and they sat in the dialog itself
	const [confirmAction, setConfirmAction] = useState<{
		title?: string;
		confirmLabel?: string;
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
	// the recent / frequent words on rows: off unless Appearance says so
	const [showHints, setShowHints] = useState(() => {
		try {
			return localStorage.getItem(HINTS_KEY) === 'on';
		} catch {
			return false;
		}
	});
	const toggleHints = () => {
		try {
			localStorage.setItem(HINTS_KEY, showHints ? 'off' : 'on');
		} catch {
			// per-viewer convenience only
		}
		setShowHints(!showHints);
	};

	const [showSettings, setShowSettings] = useState(false);
	// whether the multiplexer is on: read on mount and again when settings
	// closes (the tmux panel saves there). off, a launch is a plain shell,
	// so the verb stays Terminal even under a live chip
	const [tmuxOn, setTmuxOn] = useState(true);
	useEffect(() => {
		if (showSettings) return;
		invoke<TmuxConfig>('get_tmux_config')
			.then(c => setTmuxOn(c.enabled))
			.catch(() => {});
	}, [showSettings]);
	const selectedLive = Boolean(selected && sessions.has(selected.full_path));
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

	// the launch moment: the row that was just launched plays its motion
	// and the footer button that answered the key pulses once. 240ms, then
	// both clear. a timestamp rather than a counter in a ref: flash is
	// reachable from the palette's command list, which is built in render
	const [launching, setLaunching] = useState<Launching | null>(null);
	const flash = (kind: LaunchKind, path = selected?.full_path) => {
		if (!path) return;
		const seq = performance.now();
		setLaunching({ path, kind, seq });
		window.setTimeout(
			() => setLaunching(l => (l?.seq === seq ? null : l)),
			240
		);
	};

	// every launch path goes through one of these, so every launch flashes
	const handleLaunch = (p: Project) => {
		setSelected(p);
		flash('both', p.full_path);
		openBoth(p).catch(e => toast(showError(e)));
	};
	const launchEditor = (p: Project) => {
		flash('editor', p.full_path);
		openEditor(p).catch(e => toast(showError(e)));
	};
	const launchTerminal = (p: Project) => {
		flash('terminal', p.full_path);
		openTerminal(p).catch(e => toast(showError(e)));
	};

	const handleSearchEnter = () => {
		// a repo under the cursor takes the key: its page, not a launch
		if (treeRef.current?.openRepo()) return;
		const target = selected ?? filtered[0];
		if (target) handleLaunch(target);
	};

	// the github box: its arrows walk the github rows alone, and enter
	// opens the row under the cursor, or the first match when there is none
	const githubSearchRef = useRef<HTMLInputElement>(null);
	const handleGithubArrow = (dir: 1 | -1) =>
		treeRef.current?.navigate(dir, 'github');
	const handleGithubEnter = () => {
		if (treeRef.current?.openRepo()) return;
		const first = github.visible[0];
		if (first) handleOpenRepo(first);
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

	// the picker is three lines; every door to it used to open a settings
	// panel with a button that opened the picker
	const pickWorkspaceFolder = () => {
		openDialog({ directory: true })
			.then(picked => {
				if (typeof picked === 'string') handleAddWorkspace(picked);
			})
			.catch(e => toast(showError(e)));
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

	const handleOpenRemote = (p: Project, branch?: string) => {
		invoke('open_remote', {
			fullPath: p.full_path,
			url: null,
			branch: branch ?? null
		}).catch(e => toast(showError(e)));
	};

	// the same open_remote, through its url door; a branch reaches
	// branch_url there, so no url is assembled here
	const openUrl = (url: string, branch?: string) => {
		invoke('open_remote', { fullPath: null, url, branch: branch ?? null }).catch(
			e => toast(showError(e))
		);
	};
	const handleOpenRepo = (repo: GithubRepo, branch?: string) =>
		openUrl(repo.url, branch);

	// the same popover a project row has, for a github row: the repo page,
	// then every branch from gh api, read on the click and cached for the
	// session. one shape, two sources; the row may have no clone on disk
	const [repoBranchMenu, setRepoBranchMenu] = useState<RepoBranchMenu | null>(
		null
	);
	const openRepoBranches = (repo: GithubRepo, x: number, y: number) => {
		setRepoBranchMenu({ repo, x, y, branches: null });
		// only the popover that asked gets the answer
		const fill = (list: string[]) =>
			setRepoBranchMenu(m =>
				m && m.repo.full_name === repo.full_name ? { ...m, branches: list } : m
			);
		invoke<string[]>('get_github_branches', { fullName: repo.full_name })
			.then(fill)
			.catch(e => {
				toast(showError(e));
				fill([]);
			});
	};
	const buildRepoBranchMenu = (m: RepoBranchMenu): MenuEntry[] => {
		const def = m.repo.default_branch;
		const others = (m.branches ?? []).filter(b => b !== def);
		const open = (branch?: string) => () => handleOpenRepo(m.repo, branch);
		const rest: MenuEntry[] =
			m.branches === null
				? [{ label: 'Loading branches…', disabled: true, onClick: () => {} }]
				: others.length === 0
					? [{ label: 'No other branches', disabled: true, onClick: () => {} }]
					: others.map(b => ({ label: b, onClick: open(b) }));
		return [
			{ label: 'Open repo on GitHub', onClick: open() },
			'separator',
			...(def ? [{ label: def, hint: 'default', onClick: open(def) }] : []),
			...rest
		];
	};

	// the local mark: a github row cloned here selects its disk row
	const showLocal = (path: string) => {
		const match = projects.find(p => p.full_path === path);
		if (match) setSelected(match);
		else toast('That clone is not in a workspace DevGo scans', 'info');
	};

	const [repoMenu, setRepoMenu] = useState<RepoMenu | null>(null);

	// clones: the queue lives in the hook. a finished one rescans so the new
	// project row appears, and re-reads the github payload so its row gains
	// the local mark
	const clone = useClone((dest: string) => {
		toast(`Cloned into ${dest}`, 'success');
		refresh().catch(() => {});
		github.reload();
	});
	const [clonePicker, setClonePicker] = useState<ClonePickerRequest | null>(
		null
	);
	const [addRepoOpen, setAddRepoOpen] = useState(false);
	const [githubAddMenu, setGithubAddMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const canClone =
		workspaces.length > 0 && (github.payload?.cache.repos.length ?? 0) > 0;
	const hasRepos = (github.payload?.cache.repos.length ?? 0) > 0;

	// groups. groupMenu is the second menu under Add to group… (one entry
	// per group, ticked when the repo is in it, plus New group…);
	// groupHeaderMenu is a heading's own; namePrompt is the one dialog new
	// and rename share; groupPicker is the picker in group mode. every edit
	// goes through github.editGroups, which hands back the whole list
	const [groupMenu, setGroupMenu] = useState<RepoMenu | null>(null);
	const [groupHeaderMenu, setGroupHeaderMenu] =
		useState<GroupHeaderMenu | null>(null);
	const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
	const [groupPicker, setGroupPicker] = useState(false);
	const groupEdit = (edit: GroupEdit) =>
		github.editGroups(edit).catch(e => {
			toast(showError(e), 'error');
			throw e;
		});
	const buildGroupMenu = (repo: GithubRepo): MenuEntry[] => [
		...github.groups.map(g => {
			const member = g.repos.includes(repo.full_name);
			const edit: GroupEdit = member
				? { op: 'unassign', group: g.name, repo: repo.full_name }
				: { op: 'assign', group: g.name, repo: repo.full_name };
			return {
				label: `${member ? '✓ ' : ''}${g.name}`,
				onClick: () => groupEdit(edit).catch(() => {})
			};
		}),
		...(github.groups.length ? ['separator' as const] : []),
		{
			label: 'New group…',
			onClick: () => setNamePrompt({ kind: 'new', repos: [repo.full_name] })
		}
	];
	const buildGroupHeaderMenu = (name: string): MenuEntry[] => {
		const order = github.groups.map(g => g.name);
		const i = order.indexOf(name);
		const move = (to: number) => {
			const next = [...order];
			next.splice(i, 1);
			next.splice(to, 0, name);
			groupEdit({ op: 'reorder', order: next }).catch(() => {});
		};
		return [
			{ label: 'Rename…', onClick: () => setNamePrompt({ kind: 'rename', from: name }) },
			{ label: 'Move up', disabled: i <= 0, onClick: () => move(i - 1) },
			{
				label: 'Move down',
				disabled: i < 0 || i >= order.length - 1,
				onClick: () => move(i + 1)
			},
			'separator',
			// no confirm: a group is a label, and deleting one touches no
			// repo. the toast says so, which is the undo hint
			{
				label: `Delete group ${name}`,
				danger: true,
				onClick: () =>
					groupEdit({ op: 'delete', name })
						.then(() => toast(`Deleted group ${name}. Its repos are untouched`, 'info'))
						.catch(() => {})
			}
		];
	};

	// the branch popover: the repo on its host, then every branch the last
	// git fetch left in refs/remotes, read when the chip is clicked and
	// never in the badge pass; remembered on the project's GitInfo
	const [branchMenu, setBranchMenu] = useState<BranchMenu | null>(null);

	const openBranches = (p: Project, x: number, y: number) => {
		setBranchMenu({ project: p, x, y, branches: null });
		// only the popover that asked gets the answer
		const fill = (list: string[]) =>
			setBranchMenu(m =>
				m && m.project.full_path === p.full_path ? { ...m, branches: list } : m
			);
		invoke<string[]>('get_remote_branches', { project: p })
			.then(fill)
			.catch(e => {
				toast(showError(e));
				fill([]);
			});
	};

	// refresh from github: the live list from the api replaces what
	// refs/remotes remembered. the local list stays the default, instant
	// and usually right; this is the one place the two sources meet.
	// picking a menu entry closes the menu (ContextMenu's contract), so
	// the popover is re-opened at the same spot with the fresh list;
	// otherwise the click fetched into a menu nobody could see
	const refreshBranchesFromGithub = ({ project, x, y }: BranchMenu) => {
		invoke<string[]>('refresh_remote_branches_github', { project })
			.then(list => setBranchMenu({ project, x, y, branches: list }))
			.catch(e => toast(showError(e)));
	};

	const buildBranchMenu = (m: BranchMenu): MenuEntry[] => {
		const info = git.get(m.project.full_path);
		const host = info?.remote ? hostOf(info.remote) : 'remote';
		const current = info?.branch ?? null;
		const others = (m.branches ?? []).filter(b => b !== current);
		const open = (branch?: string) => () => handleOpenRemote(m.project, branch);
		const rest: MenuEntry[] =
			m.branches === null
				? [{ label: 'Loading branches…', disabled: true, onClick: () => {} }]
				: others.length === 0
					? [
							{
								label: 'No other branches on the remote',
								disabled: true,
								onClick: () => {}
							}
						]
					: others.map(b => ({ label: b, onClick: open(b) }));
		// the same open_remote the context menu has called since chapter 10
		return [
			{ label: `Open repo on ${host}`, onClick: open() },
			'separator',
			...(current
				? [{ label: current, hint: 'current', onClick: open(current) }]
				: []),
			...rest,
			...(host === 'GitHub'
				? [
						'separator' as const,
						{
							label: 'Refresh from GitHub',
							hint: 'gh api',
							disabled: m.branches === null,
							onClick: () => refreshBranchesFromGithub(m)
						}
					]
				: [])
		];
	};

	// navigation and the two clone urls. no git operation, no pull request,
	// no clone: that is what keeps this a menu and not a second app
	const buildRepoMenu = (repo: GithubRepo): MenuEntry[] => {
		const localPath = github.payload?.local[repo.full_name];
		const copyClone = (which: 0 | 1, label: string) => () =>
			invoke<[string, string]>('github_clone_urls', {
				fullName: repo.full_name
			})
				.then(urls => copyText(urls[which], label))
				.catch(e => toast(showError(e), 'error'));
		return [
			{ label: 'Open on GitHub', hint: 'Enter', onClick: () => handleOpenRepo(repo) },
			'separator',
			// not on disk yet: the door to getting it here. disabled, not
			// hidden, with no workspace to land in, and it says so
			...(localPath
				? []
				: [
						{
							label: 'Clone into…',
							onClick: () => setClonePicker({ preselect: repo.full_name }),
							disabled:
								workspaces.length === 0 ||
								clone.jobs.get(repo.full_name)?.status === 'running',
							hint: workspaces.length === 0 ? 'add a workspace first' : undefined
						}
					]),
			{ label: 'Copy clone URL (ssh)', onClick: copyClone(0, 'SSH clone URL') },
			{
				label: 'Copy clone URL (https)',
				onClick: copyClone(1, 'HTTPS clone URL')
			},
			'separator',
			{
				label: 'Add to group…',
				hint:
					github.groups
						.filter(g => g.repos.includes(repo.full_name))
						.map(g => g.name)
						.join(', ') || undefined,
				onClick: () =>
					setGroupMenu({ repo, x: repoMenu?.x ?? 240, y: repoMenu?.y ?? 200 })
			},
			...(localPath
				? [
						'separator' as const,
						{ label: 'Show local project', onClick: () => showLocal(localPath) }
					]
				: [])
		];
	};

	const handleOpenEditor = (targetId?: string) => {
		flash('editor');
		openEditor(undefined, targetId).catch(e => toast(showError(e)));
	};
	const handleOpenTerminal = (targetId?: string) => {
		flash('terminal');
		openTerminal(undefined, targetId).catch(e => toast(showError(e)));
	};
	const handleOpenBoth = () => {
		flash('both');
		openBoth().catch(e => toast(showError(e)));
	};
	// a target with no WSL form cannot open a WSL project; the row disables
	// it instead of letting the launch fail after the click
	const selectionIsWsl = selected?.file_system === 'WSL';

	const revealInExplorer = (p: Project) => {
		invoke('reveal_in_explorer', { path: p.full_path }).catch(e =>
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
			// one command per target; SHORTCUTS is a fixed table and N editors do
			// not fit it, the palette is where "the one I want this time" lives
			...targets.editors.map(t => ({
				id: `open.editor.${t.id}`,
				title: `Open in ${t.name}`,
				subtitle: p?.name ?? 'Select a project first',
				keywords: ['editor', 'open', t.name.toLowerCase()],
				disabled: !p || (selectionIsWsl && !t.wsl_args_template),
				run: () => handleOpenEditor(t.id)
			})),
			...targets.terminals.map(t => ({
				id: `open.terminal.${t.id}`,
				title: `Open terminal: ${t.name}`,
				subtitle: p?.name ?? 'Select a project first',
				keywords: ['terminal', 'shell', t.name.toLowerCase()],
				disabled: !p || (selectionIsWsl && !t.wsl_args_template),
				run: () => handleOpenTerminal(t.id)
			})),
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
				id: 'help',
				title: 'Help',
				subtitle: 'What DevGo is and the rules it lives by',
				keywords: ['docs', 'how', 'manual'],
				run: () => openSettings('help')
			},
			{
				id: 'about',
				title: 'About DevGo',
				subtitle: 'Version, source, third-party',
				keywords: ['version', 'licence'],
				run: () => openSettings('about')
			},
			{
				id: 'settings.github',
				title: 'Settings: GitHub',
				keywords: ['gh', 'orgs', 'repos'],
				run: () => openSettings('github')
			},
			{
				id: 'github.refresh',
				title: 'GitHub: refresh repos',
				subtitle: github.status?.login
					? `runs gh as ${github.status.login}`
					: 'gh is not logged in',
				keywords: ['gh', 'fetch', 'repositories'],
				disabled: !github.status?.login || github.refreshing,
				run: github.refresh
			},
			{
				id: 'github.clone',
				title: 'GitHub: clone repos…',
				subtitle: canClone
					? 'tick repos, pick a workspace'
					: 'needs a workspace and a fetched list',
				keywords: ['gh', 'git clone', 'download', 'scan'],
				disabled: !canClone,
				run: () => setClonePicker({})
			},
			{
				id: 'github.group',
				title: 'GitHub: group repos…',
				subtitle: 'tick repos, name a group',
				keywords: ['gh', 'label', 'organise', 'folder'],
				disabled: !hasRepos,
				run: () => setGroupPicker(true)
			},
			{
				id: 'github.add',
				title: 'GitHub: add repo by name…',
				subtitle: 'owner/name or a URL. Any owner, no clone',
				keywords: ['gh', 'watch', 'follow', 'url'],
				disabled: !github.status?.login,
				run: () => setAddRepoOpen(true)
			},
			{
				id: 'github.profile',
				title: 'GitHub: open profile',
				subtitle: github.status?.login
					? `github.com/${github.status.login}`
					: 'gh is not logged in',
				keywords: ['gh', 'me', 'browser'],
				disabled: !github.status?.login,
				run: () => openUrl(`https://github.com/${github.status?.login ?? ''}`)
			},
			{
				id: 'sort',
				title: `Sort order: ${sortMode} (cycle)`,
				keywords: ['order', 'frecency', 'activity', 'name'],
				run: toggleSort
			},
			proj('openEditor', 'Open in editor', ['code', 'edit'], launchEditor),
			proj('openTerminal', 'Open terminal', ['term', 'shell', 'wt'], launchTerminal),
			proj('openBoth', 'Open both', ['launch'], handleLaunch),
			{
				id: 'session.kill',
				title: p ? `Session: kill for ${p.name}` : 'Session: kill for this project',
				subtitle: selectedLive
					? 'The tmux / psmux session and every window in it'
					: 'No live session for the selection',
				keywords: ['tmux', 'psmux', 'session', 'kill'],
				disabled: !selectedLive,
				run: () =>
					p &&
					setConfirmAction({
						title: 'Kill session',
						confirmLabel: 'Kill',
						message: `Kill the session for ${p.name}? Every window in it closes.`,
						run: () =>
							invoke('kill_session', { project: p })
								.then(() => {
									forgetSession(p.full_path);
									toast(`Session for ${p.name} killed`, 'info');
								})
								.catch(e => toast(showError(e), 'error'))
					})
			},
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

	const buildMenu = (p: Project): MenuEntry[] => {
		const hint = (id: ShortcutId) => prettyKeys(shortcutFor(id));
		const remote = git.get(p.full_path)?.remote;
		const pinned = ranks.get(p.full_path)?.pinned ?? false;
		return [
			{
				label: 'Open in editor',
				hint: hint('openEditor'),
				onClick: () => launchEditor(p)
			},
			{
				label:
					sessions.has(p.full_path) && tmuxOn
						? 'Reattach terminal'
						: 'Open terminal',
				hint: hint('openTerminal'),
				onClick: () => launchTerminal(p)
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
			},
			'separator',
			// the row the eye lands on is a project, and "get rid of this
			// workspace" was only on the header's menu. same lookup and the
			// same confirm as the header entry, so two menus reach one path
			{
				label: `Remove workspace ${lastSegment(p.workspace)}`,
				danger: true,
				onClick: () => {
					const idx = workspaces.indexOf(p.workspace);
					if (idx >= 0) setRemoveIndex(idx);
					else toast(`${lastSegment(p.workspace)} is no longer in the list`, 'error');
				}
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
			if (fire('focusGithubSearch', () => githubSearchRef.current?.select()))
				return;
			if (fire('clearSearch', () => setQuery(''))) return;
			if (fire('refresh', handleRefresh)) return;
			if (fire('settings', () => openSettings())) return;
			if (fire('textBigger', () => stepTextScale(1).catch(() => {}))) return;
			if (fire('textSmaller', () => stepTextScale(-1).catch(() => {}))) return;
			if (fire('textReset', () => applyTextScale(1).catch(() => {}))) return;
			if (fire('quit', () => invoke('quit_app').catch(() => {}))) return;
			if (fire('addWorkspace', pickWorkspaceFolder)) return;
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
			if (fire('openEditor', () => handleOpenEditor())) return;
			if (fire('openTerminal', () => handleOpenTerminal())) return;
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
				maximized ? '' : 'rounded-panel'
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
					{/* the wsl chip stays up here, not in the row: it has to work
					    when the table shows no wsl workspace, which is exactly when a
					    distro wedges */}
					<Button
						variant='ghost'
						className='w-7 h-7 text-15 font-semibold'
						onClick={() => openSettings('help')}
						title='Help'
					>
						?
					</Button>
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
						onSummonChanged: setSummonHotkey,
						targets,
						github,
						showHints,
						onToggleHints: toggleHints
					}}
				/>
			</Suspense>

			{/* the palette was its own overlay dropping from the top; it is the
			    top drawer's first user, so the surface, the slide and escape are
			    the code the confirm sheets run */}
			<Drawer
				{...{
					side: 'top' as const,
					open: paletteOpen,
					onClose: () => setPaletteOpen(false),
					width: 'w-[min(780px,92vw)]'
				}}
			>
				{paletteOpen && (
					<CommandPalette
						{...{
							commands: buildCommands(),
							onClose: () => setPaletteOpen(false)
						}}
					/>
				)}
			</Drawer>

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

			{githubAddMenu && (
				<ContextMenu
					{...{
						x: githubAddMenu.x,
						y: githubAddMenu.y,
						items: [
							{
								label: 'Clone repos…',
								onClick: () => setClonePicker({}),
								disabled: !canClone,
								hint: workspaces.length === 0 ? 'add a workspace first' : undefined
							},
							{
								label: 'Add repo by name…',
								onClick: () => setAddRepoOpen(true),
								disabled: !github.status?.login
							},
							'separator',
							{
								label: 'Group repos…',
								onClick: () => setGroupPicker(true),
								disabled: !hasRepos
							}
						],
						onClose: () => setGithubAddMenu(null)
					}}
				/>
			)}

			{groupMenu && (
				<ContextMenu
					{...{
						x: groupMenu.x,
						y: groupMenu.y,
						items: buildGroupMenu(groupMenu.repo),
						onClose: () => setGroupMenu(null)
					}}
				/>
			)}

			{groupHeaderMenu && (
				<ContextMenu
					{...{
						x: groupHeaderMenu.x,
						y: groupHeaderMenu.y,
						items: buildGroupHeaderMenu(groupHeaderMenu.name),
						onClose: () => setGroupHeaderMenu(null)
					}}
				/>
			)}

			<Drawer
				{...{
					side: 'right' as const,
					open: namePrompt !== null,
					title:
						namePrompt?.kind === 'rename' ? `Rename ${namePrompt.from}` : 'New group',
					onClose: () => setNamePrompt(null)
				}}
			>
				{namePrompt && (
					<NameDialog
						{...{
							hint:
								namePrompt.kind === 'rename'
									? 'A new name for the group. Its repos stay where they are.'
									: `A name for the group. ${
											namePrompt.repos.length === 1
												? `${namePrompt.repos[0]} goes`
												: `${namePrompt.repos.length} repos go`
										} in it.`,
							initial: namePrompt.kind === 'rename' ? namePrompt.from : '',
							submitLabel: namePrompt.kind === 'rename' ? 'Rename' : 'Create group',
							onSubmit: async (name: string) => {
								if (namePrompt.kind === 'rename') {
									await github.editGroups({ op: 'rename', from: namePrompt.from, to: name });
									return;
								}
								for (const repo of namePrompt.repos) {
									await github.editGroups({ op: 'assign', group: name, repo });
								}
							},
							onDone: () => setNamePrompt(null)
						}}
					/>
				)}
			</Drawer>

			<Drawer
				{...{
					side: 'right' as const,
					open: groupPicker,
					title: 'Group repos',
					onClose: () => setGroupPicker(false),
					width: 'w-[min(640px,92vw)]'
				}}
			>
				{groupPicker && (
					<ClonePicker
						{...{
							mode: 'group' as const,
							repos: github.payload?.cache.repos ?? [],
							local: github.payload?.local ?? {},
							workspaces,
							groups: github.groups,
							onStart: () => {},
							onGroup: async (repos: GithubRepo[], group: string) => {
								for (const r of repos) {
									await github.editGroups({ op: 'assign', group, repo: r.full_name });
								}
								toast(
									`${repos.length === 1 ? repos[0].name : `${repos.length} repos`} → ${group.trim()}`,
									'success'
								);
							},
							onDone: () => setGroupPicker(false)
						}}
					/>
				)}
			</Drawer>

			<Drawer
				{...{
					side: 'right' as const,
					open: clonePicker !== null,
					title: 'Clone from GitHub',
					onClose: () => setClonePicker(null),
					width: 'w-[min(640px,92vw)]'
				}}
			>
				{clonePicker && (
					<ClonePicker
						{...{
							repos: github.payload?.cache.repos ?? [],
							local: github.payload?.local ?? {},
							workspaces,
							preselect: clonePicker.preselect,
							onStart: (repos: GithubRepo[], workspace: string) => {
								clone.enqueue(repos, workspace);
								toast(
									repos.length === 1
										? `Cloning ${repos[0].name} into ${lastSegment(workspace)}…`
										: `Cloning ${repos.length} repos into ${lastSegment(workspace)}, one at a time…`,
									'info'
								);
							},
							onDone: () => setClonePicker(null)
						}}
					/>
				)}
			</Drawer>

			<Drawer
				{...{
					side: 'right' as const,
					open: addRepoOpen,
					title: 'Add a repo by name',
					onClose: () => setAddRepoOpen(false)
				}}
			>
				{addRepoOpen && (
					<AddRepo
						{...{
							onAdded: (r: GithubRepo) => {
								toast(`Added ${r.full_name} to the GitHub list`, 'success');
								github.reload();
							},
							onDone: () => setAddRepoOpen(false)
						}}
					/>
				)}
			</Drawer>

			{repoMenu && (
				<ContextMenu
					{...{
						x: repoMenu.x,
						y: repoMenu.y,
						items: buildRepoMenu(repoMenu.repo),
						onClose: () => setRepoMenu(null)
					}}
				/>
			)}

			{branchMenu && (
				<ContextMenu
					{...{
						x: branchMenu.x,
						y: branchMenu.y,
						items: buildBranchMenu(branchMenu),
						onClose: () => setBranchMenu(null)
					}}
				/>
			)}

			{repoBranchMenu && (
				<ContextMenu
					{...{
						x: repoBranchMenu.x,
						y: repoBranchMenu.y,
						items: buildRepoBranchMenu(repoBranchMenu),
						onClose: () => setRepoBranchMenu(null)
					}}
				/>
			)}

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

			{/* discovery used to live only on the empty screen, so from the
			    first workspace on the scan was unreachable. the same picker
			    as Onboarding; the modal is the only difference */}
			<Drawer
				{...{
					side: 'right' as const,
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
			</Drawer>

			<ConfirmDialog
				{...{
					open: confirmAction !== null,
					title: confirmAction?.title ?? 'Stop WSL',
					message: confirmAction?.message ?? '',
					confirmLabel: confirmAction?.confirmLabel ?? 'Stop',
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
					title: 'Remove workspace',
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

			<div className='flex-1 flex flex-col w-full px-6 py-5 gap-4 overflow-hidden'>
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
						{/* the command row: the project box spans the table it searches
						    (it capped at 1100px; a heading spans what it heads), the sort
						    beside it, then the two controls that change what the list
						    holds, which lived in the title bar; this is the list's row.
						    the github box sits level with it at a fixed share, so the
						    project box is the wider one at every width, with the github
						    rows' own three controls beside it */}
						<div className='w-full shrink-0 flex items-center gap-4'>
						<div className='flex-1 min-w-0 flex items-center gap-3'>
							<SearchBox
								{...{
									ref: searchRef,
									value: query,
									onChange: setQuery,
									onEnter: handleSearchEnter,
									onArrow: handleArrow,
									enterHint:
										selected || filtered.length > 0 ? '⏎ Enter' : undefined,
									className: 'flex-1 min-w-0'
								}}
							/>
							<div
								className='flex items-center gap-1 shrink-0'
								role='group'
								title='Sort order'
							>
								{SORT_MODES.map(m => (
									<Button
										key={m.mode}
										variant='target'
										aria-current={sortMode === m.mode ? 'true' : undefined}
										onClick={() => setSort(m.mode)}
									>
										{m.label}
									</Button>
								))}
							</div>
							<Button
								variant='ghost'
								className='gap-1 px-2 shrink-0'
								onClick={e => {
									const r = e.currentTarget.getBoundingClientRect();
									setAddMenu({ x: r.left, y: r.bottom + 4 });
								}}
								title={`Add workspace (${prettyKeys(shortcutFor('addWorkspace'))})`}
							>
								<span className='text-18 leading-none'>+</span>
								<span className='text-13 font-semibold leading-none'>
									Workspace
								</span>
								<span className='text-11 leading-none opacity-70'>▾</span>
							</Button>
							<Button
								variant='ghost'
								className='w-7 h-7 shrink-0'
								onClick={handleRefresh}
								title={`Refresh (${prettyKeys(shortcutFor('refresh'))})`}
							>
								<svg
									width='15'
									height='15'
									viewBox='0 0 24 24'
									fill='none'
									stroke='currentColor'
									strokeWidth='2'
									strokeLinecap='round'
									strokeLinejoin='round'
								>
									<path d='M21 12a9 9 0 1 1-2.64-6.36' />
									<polyline points='21 3 21 9 15 9' />
								</svg>
							</Button>
						</div>
						{github.available && (
							<SearchBox
								{...{
									ref: githubSearchRef,
									value: github.query,
									onChange: github.setQuery,
									onEnter: handleGithubEnter,
									onArrow: handleGithubArrow,
									placeholder: 'Search GitHub repos…',
									lane: 'github' as const,
									enterHint: hasRepos ? '⏎ Enter' : undefined,
									className: 'w-[clamp(200px,24%,400px)] shrink-0'
								}}
							/>
						)}
						{github.available && (
							<GithubControls
								{...{
									github,
									onAddMenu: (x: number, y: number) => setGithubAddMenu({ x, y })
								}}
							/>
						)}
						</div>
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
								sessions,
								pinnedProjects,
								onTogglePin: handleTogglePin,
								onOpenBranches: openBranches,
								onContextMenu: (p: Project, x: number, y: number) =>
									setMenu({ project: p, x, y }),
								onWorkspaceContextMenu: (ws: string, x: number, y: number) =>
									setScriptMenu({ x, y, items: buildWorkspaceMenu(ws) }),
								workspaceOrder: workspaces,
								// the store may refuse an order built from a stale list; the
								// message says to refresh, and refreshing is what fixes it
								onReorder: (order: string[]) =>
									reorderWorkspaces(order).catch(e => {
										toast(showError(e));
										refreshWorkspaces();
									}),
								github,
								onRepoOpen: handleOpenRepo,
								onRepoBranches: openRepoBranches,
								onRepoContextMenu: (r: GithubRepo, x: number, y: number) =>
									setRepoMenu({ repo: r, x, y }),
								onShowLocal: showLocal,
								cloneJobs: clone.jobs,
								onGroupContextMenu: (name: string, x: number, y: number) =>
									setGroupHeaderMenu({ name, x, y }),
								showHints,
								launchingPath: launching?.path ?? null
							}}
						/>
					</>
				)}
			</div>

			{dragOver && (
				<div className='fixed inset-0 z-50 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent m-2 rounded-panel pointer-events-none'>
					<span className='text-18 font-semibold text-accent bg-bg-secondary/90 px-5 py-2.5 rounded-control border border-accent'>
						Drop a folder to add a workspace
					</span>
				</div>
			)}

			<StatusBar
				{...{
					hasSelection: selected !== null,
					selectionIsWsl,
					editors: targets.editors,
					terminals: targets.terminals,
					defaults: targets.defaults,
					onEditor: handleOpenEditor,
					onTerminal: handleOpenTerminal,
					onBoth: handleOpenBoth,
					onManageTargets: () => openSettings('targets'),
					onOpenPalette: () => setPaletteOpen(true),
					onOpenHelp: () => openSettings('help'),
					reattach: selectedLive && tmuxOn,
					pulse: launching?.kind ?? null
				}}
			/>
		</div>
	);
};

const App = () => {
	// The window is created hidden (tauri.conf.json) and shown once React has
	// painted, so a cold start never flashes a white rectangle; the ground's
	// alpha is read first, so a see-through install never flashes opaque
	useEffect(() => {
		loadGroundAlpha().finally(() => getCurrentWindow().show());
	}, []);

	return (
		<ToastProvider>
			<AppInner />
		</ToastProvider>
	);
};

export default App;
