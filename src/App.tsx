import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import ActionForm from './components/ActionForm';
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
import RefreshIcon from './components/RefreshIcon';
import ScanPicker from './components/ScanPicker';
import SearchBox from './components/SearchBox';
import ServerForm from './components/ServerForm';
import StatusBar from './components/StatusBar';
import TitleBar from './components/TitleBar';
import FileSystems from './components/FileSystems';
import ToastProvider, { useToast } from './components/Toast';
import { useClone } from './hooks/useClone';
import { useGithub } from './hooks/useGithub';
import { useLaunchActions } from './hooks/useLaunchActions';
import { useMaximized } from './hooks/useMaximized';
import { useProjects } from './hooks/useProjects';
import { useServers } from './hooks/useServers';
import { useTargets } from './hooks/useTargets';
import { useWorkspaces } from './hooks/useWorkspaces';
import { useRuntime } from './hooks/useRuntime';
import { useWsl } from './hooks/useWsl';
import { lastSegment } from './paths';
import { isMac } from './platform';
import {
	appForFolder,
	canFill,
	fillLabel,
	placeholders,
	prefillValues
} from './serverApps';
import {
	isTypingTarget,
	labelFor,
	matches,
	prettyKeys,
	shortcutFor
} from './shortcuts';
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
		refreshWorkspace,
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
	const {
		addWorkspace,
		removeWorkspace,
		openEditor,
		openTerminal,
		openAgent,
		openBoth
	} = useLaunchActions(selected, refresh);
	// the github group. reads its cache on mount and re-reads after every
	// pass (the list and the badges are its dependencies) so the local
	// marks track the disk. its box is its own; the project query never
	// reaches it
	const github = useGithub(projects, git);
	// the machines you ssh into: its own file, no network
	const servers = useServers();
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

	// the wsl chip: mount, focus and the backend's vm watcher live in the
	// hook; the passes the app already makes re-read it too, as since 12
	const { wsl, refreshWsl } = useWsl();
	useEffect(refreshWsl, [workspaceStates]);
	// the machine: the forced refresh re-probes it, and lands as a pass
	const { runtime, refreshRuntime } = useRuntime();
	useEffect(refreshRuntime, [workspaceStates]);

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

	// one workspace, the ask names it: the toast says what it found, or
	// that the cached list is what stays on screen
	const handleRefreshWorkspace = (ws: string) => {
		refreshWorkspace(ws)
			.then(payload => {
				const st = payload.workspaces[0];
				const live = st?.status === 'live';
				toast(
					live
						? `${lastSegment(ws)}: ${st.count} project${st.count === 1 ? '' : 's'}`
						: `${lastSegment(ws)} is unavailable, showing the cached list`,
					live ? 'success' : 'info'
				);
			})
			.catch(e => toast(showError(e)));
	};

	// move ws to sit before or after target in the store's order, the way
	// the tree's drag and alt+arrows do through onReorder
	const moveWorkspaceBeside = (
		ws: string,
		target: string | undefined,
		after: boolean
	) => {
		if (!target || ws === target) return;
		const without = workspaces.filter(w => w !== ws);
		const at = without.indexOf(target);
		if (at < 0) return;
		without.splice(after ? at + 1 : at, 0, ws);
		reorderWorkspaces(without).catch(e => {
			toast(showError(e));
			refreshWorkspaces();
		});
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

	// one function for the palette and the row's menu, so both confirm
	// with the same words
	const killSession = (p: Project) =>
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
		});

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
	// project row appears, and that pass is what marks its github row local
	const clone = useClone((dest: string) => {
		toast(`Cloned into ${dest}`, 'success');
		refresh().catch(() => {});
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
	// group preselects the destination: a heading's own add repos… opens
	// the picker already pointed at itself
	const [groupPicker, setGroupPicker] = useState<{ group?: string } | null>(
		null
	);
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
			// the group's own door for taking repos in; before it the only ways
			// were a repo's add to group… or the picker from the palette
			{ label: `Add repos to ${name}…`, onClick: () => setGroupPicker({ group: name }) },
			'separator',
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
	const handleOpenAgent = (targetId?: string) => {
		flash('agent');
		openAgent(undefined, targetId).catch(e => toast(showError(e)));
	};
	// a target with no WSL form cannot open a WSL project; the row disables
	// it instead of letting the launch fail after the click
	const selectionIsWsl = selected?.file_system === 'WSL';

	const revealInExplorer = (p: Project) => {
		invoke('reveal_in_explorer', { path: p.full_path }).catch(e =>
			toast(showError(e))
		);
	};
	// a workspace is a bare path; the same door takes it
	const revealWorkspace = (ws: string) => {
		invoke('reveal_in_explorer', { path: ws }).catch(e => toast(showError(e)));
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

	const copyWindowsPath = (p: Project) =>
		copyText(p.full_path, isMac ? 'path' : 'Windows path');

	const copyWslPath = async (p: Project) => {
		try {
			const wsl = await invoke<string>('get_wsl_path', { project: p });
			await copyText(wsl, 'WSL path');
		} catch (e) {
			toast(showError(e));
		}
	};

	// servers: the row menu, the card's + menu, and the add/edit form
	const [serverMenu, setServerMenu] = useState<ServerMenu | null>(null);
	const [serversAddMenu, setServersAddMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [serverForm, setServerForm] = useState<{ initial?: Server } | null>(
		null
	);
	const openServer = (s: Server) =>
		invoke('open_server', { id: s.id, targetId: null }).catch(e =>
			toast(showError(e))
		);
	const importSsh = () =>
		servers
			.importSshConfig()
			.then(({ added, updated }) =>
				toast(
					added + updated === 0
						? 'Nothing new in ~/.ssh/config'
						: `Imported ${added} new, ${updated} updated from ~/.ssh/config`,
					'success'
				)
			)
			.catch(e => toast(showError(e)));
	const copyServerLine = (s: Server, which: 0 | 1) =>
		invoke<[string, string]>('server_commands', { id: s.id })
			.then(lines =>
				copyText(lines[which], which === 0 ? 'ssh command' : 'scp prefix')
			)
			.catch(e => toast(showError(e)));
	const saveServer = async (draft: ServerDraft) => {
		if (draft.id) await servers.update(draft as Server);
		else await servers.add(draft);
		toast(draft.id ? `Saved ${draft.name}` : `Added ${draft.name}`, 'success');
	};
	const openFolder = (s: Server, f: RemoteFolder) =>
		invoke('open_server_folder', { id: s.id, path: f.path }).catch(e =>
			toast(showError(e))
		);
	const openFolderIn = (s: Server, f: RemoteFolder, editor: string) =>
		invoke('open_server_folder_in', { id: s.id, path: f.path, editor }).catch(
			e => toast(showError(e))
		);
	const [folderMenu, setFolderMenu] = useState<FolderMenu | null>(null);
	// one of the actions the server declares. rust types the line into a
	// tmux window and attaches the terminal to it; with no tmux on the row
	// the line comes back for the clipboard and the terminal opens plain.
	// the toast says which of those happened
	const runServerAction = (
		s: Server,
		action: ServerAction,
		appDir: string | null,
		values?: Record<string, string>,
		preview?: boolean
	) =>
		invoke<ActionOutcome>('run_server_action', {
			id: s.id,
			actionId: action.id,
			appDir,
			values: values ?? null,
			preview: preview ?? null
		})
			.then(async out => {
				if (out.kind === 'ran') toast(`Running in ${out.window} on ${s.name}`, 'success');
				else if (out.kind === 'typed')
					toast(`Typed into ${out.window} on ${s.name}. Enter runs it`, 'success');
				else if (out.kind === 'copied') {
					await copyText(out.line, 'line');
					await invoke('open_server', { id: s.id, targetId: null });
					toast(`${s.name} has no tmux. The line is copied; paste it in the terminal`, 'success');
				} else if (out.kind === 'local')
					toast(`${action.label}: running on this PC`, 'success');
			})
			.catch(e => toast(showError(e)));
	// a form action opens its drawer instead of running; the others run
	const [actionForm, setActionForm] = useState<ActionFormRequest | null>(null);
	const fireAction = (
		s: Server,
		a: ServerAction,
		appDir: string | null,
		app?: ServerApp
	) =>
		a.kind === 'form'
			? setActionForm({ server: s, action: a, appDir, initial: prefillValues(a, app) })
			: runServerAction(s, a, appDir);
	// the hint beside an action: what kind of door it is
	const actionHint = (a: ServerAction, s: Server) => {
		const bits = [
			a.root ? 'sudo' : null,
			a.kind === 'form' ? 'form' : null,
			a.kind === 'pretype' ? (s.tmux ? 'types' : 'copies') : null,
			a.kind === 'run' && !s.tmux ? 'copies' : null,
			a.kind === 'url' ? '↗' : null,
			a.kind === 'local' ? 'this PC' : null
		].filter(Boolean);
		return bits.join(' · ') || undefined;
	};
	// the declared actions under their group headings, clustered by group
	// in the order the groups first appear: an entry declared late in the
	// file still sits under its heading
	const groupedEntries = (
		acts: ServerAction[],
		entry: (a: ServerAction) => MenuAction
	): MenuEntry[] => {
		const byGroup = new Map<string, ServerAction[]>();
		for (const a of acts) {
			const g = a.group ?? '';
			byGroup.set(g, [...(byGroup.get(g) ?? []), a]);
		}
		return [...byGroup].flatMap(([g, list]) => [
			...(g ? [{ heading: g }] : []),
			...list.map(entry)
		]);
	};
	const serverActionEntries = (s: Server): MenuEntry[] => {
		const acts = servers.listings[s.id]?.actions?.server ?? [];
		if (acts.length === 0) return [];
		return [
			'separator',
			...groupedEntries(acts, a => ({
				label: a.label,
				hint: actionHint(a, s),
				onClick: () => fireAction(s, a, null)
			}))
		];
	};
	// hidden, not disabled, when the row cannot fill the line: the
	// contract's own rule
	const appActionEntries = (s: Server, f: RemoteFolder): MenuEntry[] => {
		const listing = servers.listings[s.id];
		const app = appForFolder(listing, f.path);
		if (!app) return [];
		const values = placeholders(app);
		// or the label: Logs · {pm2_api} names its process, and an app without
		// an api has no such entry
		const acts = (listing?.actions?.app ?? []).filter(
			a => canFill(a.command, values) && canFill(a.label, values)
		);
		if (acts.length === 0) return [];
		return [
			'separator',
			...groupedEntries(acts, a => ({
				label: fillLabel(a.label, values),
				hint: actionHint(a, s),
				onClick: () => fireAction(s, a, f.path, app)
			}))
		];
	};
	// the name box for a root typed by hand, on this server
	const [rootPrompt, setRootPrompt] = useState<Server | null>(null);
	const addRoot = async (s: Server, root: string) => {
		await invoke('add_server_root', { id: s.id, root });
		await servers.reload();
		await servers.listFolders(s.id);
	};
	const removeRoot = async (s: Server, root: string) => {
		await invoke('remove_server_root', { id: s.id, root });
		await servers.reload();
		await servers.listFolders(s.id);
	};
	const unpinEntry = (s: Server, root: string, label: string): MenuEntry => ({
		label,
		hint: 'its folders stay on the server',
		onClick: () =>
			removeRoot(s, root)
				.then(() => toast(`${root} is no longer a top-level group on ${s.name}`, 'info'))
				.catch(e => toast(showError(e)))
	});
	// a remote editor entry is offered when that editor is a detected target
	const hasEditor = (id: string) => targets.editors.some(t => t.id === id);
	const buildFolderMenu = (s: Server, f: RemoteFolder): MenuEntry[] => [
		{ label: 'Open terminal here', hint: 'Enter', onClick: () => openFolder(s, f) },
		{ label: 'Look inside', onClick: () => servers.toggleDir(s.id, f.path) },
		s.roots.includes(f.path)
			? unpinEntry(s, f.path, 'Unpin from top level')
			: {
					// the card groups a server's folders under its top-level
					// folders; this lifts the folder you are on to that level
					label: 'Pin as a top-level group',
					hint: 'beside ~ · /var/www',
					onClick: () =>
						addRoot(s, f.path)
							.then(() => toast(`${f.path} is a top-level group on ${s.name} now`, 'success'))
							.catch(e => toast(showError(e)))
				},
		'separator',
		{
			label: 'Open in VS Code (Remote-SSH)',
			disabled: !hasEditor('vscode'),
			onClick: () => openFolderIn(s, f, 'vscode')
		},
		{
			label: 'Open in Zed (remote)',
			disabled: !hasEditor('zed'),
			onClick: () => openFolderIn(s, f, 'zed')
		},
		...appActionEntries(s, f),
		'separator',
		{ label: 'Copy path', onClick: () => copyText(f.path, 'path') },
		{
			label: 'Copy scp path',
			onClick: () =>
				invoke<[string, string]>('server_commands', { id: s.id })
					.then(([, scp]) => copyText(`${scp}${f.path}`, 'scp path'))
					.catch(e => toast(showError(e)))
		}
	];
	// the heading is the row that owns the pin, so the unpin lives here. the
	// four defaults can go too: the store writes them out first
	const [rootMenu, setRootMenu] = useState<RootMenu | null>(null);
	const buildRootMenu = (s: Server, root: string): MenuEntry[] => [
		unpinEntry(s, root, `Unpin ${root} from top level`),
		{ label: 'List another folder at top level…', onClick: () => setRootPrompt(s) },
		'separator',
		{ label: 'Copy path', onClick: () => copyText(root, 'path') }
	];
	const buildServerMenu = (s: Server): MenuEntry[] => [
		{ label: 'Open terminal', hint: 'Enter', onClick: () => openServer(s) },
		{
			label: 'List folders & apps',
			onClick: () => servers.listFolders(s.id).catch(e => toast(showError(e)))
		},
		{ label: 'List another folder at top level…', onClick: () => setRootPrompt(s) },
		...serverActionEntries(s),
		'separator',
		{ label: 'Copy ssh command', onClick: () => copyServerLine(s, 0) },
		{ label: 'Copy scp prefix', onClick: () => copyServerLine(s, 1) },
		// a LocalForward host is a tunnel: ssh -N holds it open with no shell,
		// which is what such a row exists for. by alias only
		...(s.tunnel && s.alias
			? [
					{
						label: 'Copy tunnel command',
						hint: `ssh -N ${s.alias}`,
						onClick: () => copyText(`ssh -N ${s.alias}`, 'tunnel command')
					}
				]
			: []),
		'separator',
		{ label: 'Edit…', onClick: () => setServerForm({ initial: s }) },
		{
			label: 'Remove',
			danger: true,
			onClick: () =>
				setConfirmAction({
					title: 'Remove server',
					confirmLabel: 'Remove',
					message: `Remove ${s.name} from the list? Your ssh config and keys are untouched.`,
					run: () => servers.remove(s.id).catch(e => toast(showError(e)))
				})
		}
	];
	const serversAddItems: MenuEntry[] = [
		{ label: 'Add a server…', onClick: () => setServerForm({}) },
		{ label: 'Import from ~/.ssh/config', onClick: importSsh }
	];

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
			...targets.agents.map(t => ({
				id: `open.agent.${t.id}`,
				title: `Open in ${t.name}`,
				subtitle: p ? `${p.name}, in your terminal` : 'Select a project first',
				keywords: ['agent', 'ai', 'claude', 'codex', t.name.toLowerCase()],
				disabled: !p || (selectionIsWsl ? !t.wsl_executable : !t.executable),
				run: () => handleOpenAgent(t.id)
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
				run: () => setGroupPicker({})
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
				id: 'settings.servers',
				title: 'Settings: Servers',
				keywords: ['ssh', 'server', 'machines'],
				run: () => openSettings('servers')
			},
			...servers.servers.map(s => ({
				id: `server.open.${s.id}`,
				title: `Server: open ${s.name}`,
				subtitle: `ssh ${s.alias ?? `${s.user ? `${s.user}@` : ''}${s.host}`}`,
				keywords: ['server', 'ssh', 'connect', s.name.toLowerCase(), s.host],
				run: () => openServer(s)
			})),
			// the server-level actions a box declares, not the per-app ones:
			// twenty apps by seventeen actions is a menu, not a palette
			...servers.servers.flatMap(s =>
				(servers.listings[s.id]?.actions?.server ?? []).map(a => ({
					id: `server.action.${s.id}.${a.id}`,
					title: `Server: ${s.name} › ${a.label}`,
					subtitle: a.command,
					keywords: ['server', s.name.toLowerCase(), a.id, ...a.id.split('-')],
					run: () => fireAction(s, a, null)
				}))
			),
			{
				id: 'servers.import',
				title: 'Servers: import from ~/.ssh/config',
				subtitle: 'Every Host block becomes a row; the file is never written',
				keywords: ['ssh', 'config', 'import', 'server'],
				disabled: !servers.hasSsh,
				run: importSsh
			},
			{
				id: 'servers.add',
				title: 'Servers: add a server…',
				keywords: ['ssh', 'server', 'add', 'host'],
				disabled: !servers.hasSsh,
				run: () => setServerForm({})
			},
			{
				id: 'sort',
				title: `Sort order: ${sortMode} (cycle)`,
				keywords: ['order', 'frecency', 'activity', 'name'],
				run: toggleSort
			},
			// the workspace actions the keys have; the palette promised every
			// action and offered only settings › workspaces
			{
				id: 'addWorkspace',
				title: 'Add workspace…',
				subtitle: 'Pick a folder that holds projects',
				hint: hint('addWorkspace'),
				keywords: ['workspace', 'folder', 'new'],
				run: pickWorkspaceFolder
			},
			{
				id: 'refreshWorkspace',
				title: p
					? `Refresh workspace ${lastSegment(p.workspace)}`
					: 'Refresh workspace',
				subtitle: p
					? 'This one only, boots its distro if stopped'
					: 'Select a project first',
				keywords: ['workspace', 'rescan', 'one'],
				disabled: !p,
				run: () => p && handleRefreshWorkspace(p.workspace)
			},
			{
				id: 'revealWorkspace',
				title: p
					? `Reveal workspace ${lastSegment(p.workspace)} in Explorer`
					: 'Reveal workspace in Explorer',
				subtitle: p?.workspace ?? 'Select a project first',
				hint: hint('revealWorkspace'),
				keywords: ['workspace', 'folder', 'explorer'],
				disabled: !p,
				run: () => p && revealWorkspace(p.workspace)
			},
			...([-1, 1] as const).map(dir => ({
				id: dir < 0 ? 'moveWorkspaceUp' : 'moveWorkspaceDown',
				title: `Move workspace${p ? ` ${lastSegment(p.workspace)}` : ''} ${dir < 0 ? 'up' : 'down'}`,
				hint: hint(dir < 0 ? 'moveWorkspaceUp' : 'moveWorkspaceDown'),
				keywords: ['workspace', 'order', 'reorder'],
				disabled: !p,
				run: () => {
					if (!p) return;
					const i = workspaces.indexOf(p.workspace);
					moveWorkspaceBeside(p.workspace, workspaces[i + dir], dir > 0);
				}
			})),
			{
				id: 'removeWorkspace',
				title: p
					? `Remove workspace ${lastSegment(p.workspace)}`
					: 'Remove workspace',
				subtitle: p ? 'Asks first; the folder is untouched' : 'Select a project first',
				hint: hint('removeWorkspace'),
				keywords: ['workspace', 'delete', 'forget'],
				disabled: !p,
				run: handleRemoveShortcut
			},
			{
				id: 'runScript',
				title: 'Run dev script…',
				hint: hint('runScript'),
				subtitle: p ? `${p.name}, reads its package.json` : 'Select a project first',
				keywords: ['npm', 'bun', 'pnpm', 'script', 'dev', 'start'],
				disabled: !p,
				// the palette has closed and there is no click to anchor to, so
				// the script menu takes the row menu's fallback spot
				run: () => p && openScripts(p, 240, 200)
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
				run: () => p && killSession(p)
			},
			proj(
				'revealExplorer',
				labelFor('revealExplorer'),
				['folder', 'files', 'explorer', 'finder'],
				revealInExplorer
			),
			proj('copyWinPath', labelFor('copyWinPath'), ['path', 'clipboard'], copyWindowsPath),
			// a mac has no second filesystem to have a path in
			...(isMac
				? []
				: [proj('copyWslPath', labelFor('copyWslPath'), ['path', 'linux'], copyWslPath)]),
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
				hint: hint('openRemote'),
				subtitle: p.name,
				keywords: ['git', 'github', 'url'],
				run: () => handleOpenRemote(p)
			});
		}
		if (wsl.distros.length > 0) {
			commands.push({
				id: 'wsl.shutdown',
				title: 'Shut down all WSL',
				subtitle: wsl.distros.join(', '),
				keywords: ['wsl', 'stop', 'kill'],
				run: () =>
					setConfirmAction({
						message:
							'Shut down all of WSL? This stops every distro and the virtual machine itself, including Docker Desktop on the WSL2 backend.',
						run: () =>
							invoke<string>('shutdown_wsl')
								.then(m => toast(m, 'success'))
								.catch(e => toast(showError(e), 'error'))
								.finally(refreshWsl)
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
	// lookup missed.
	// "refresh this workspace" used to call the global f5 under a label that
	// said otherwise; it is per-workspace now. move up / down mirror the
	// github group heading: two headings that look alike offer alike
	const buildWorkspaceMenu = (ws: string): MenuEntry[] => {
		const i = workspaces.indexOf(ws);
		const wsl = ws.replace(/\\/g, '/').startsWith('//wsl');
		return [
			{
				label: 'Refresh this workspace',
				hint: wsl ? 'boots its distro if stopped' : undefined,
				onClick: () => handleRefreshWorkspace(ws)
			},
			{
				label: 'Refresh projects',
				hint: prettyKeys(shortcutFor('refresh')),
				onClick: handleRefresh
			},
			{
				label: labelFor('revealExplorer'),
				hint: prettyKeys(shortcutFor('revealWorkspace')),
				onClick: () => revealWorkspace(ws)
			},
			'separator',
			{
				label: 'Move up',
				hint: prettyKeys(shortcutFor('moveWorkspaceUp')),
				disabled: i <= 0,
				onClick: () => moveWorkspaceBeside(ws, workspaces[i - 1], false)
			},
			{
				label: 'Move down',
				hint: prettyKeys(shortcutFor('moveWorkspaceDown')),
				disabled: i < 0 || i >= workspaces.length - 1,
				onClick: () => moveWorkspaceBeside(ws, workspaces[i + 1], true)
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
	};

	const buildMenu = (p: Project): MenuEntry[] => {
		const hint = (id: ShortcutId) => prettyKeys(shortcutFor(id));
		const remote = git.get(p.full_path)?.remote;
		const pinned = ranks.get(p.full_path)?.pinned ?? false;
		const live = sessions.has(p.full_path) && tmuxOn;
		return [
			{
				label: 'Open in editor',
				hint: hint('openEditor'),
				onClick: () => launchEditor(p)
			},
			{
				label: live ? 'Reattach terminal' : 'Open terminal',
				hint: hint('openTerminal'),
				onClick: () => launchTerminal(p)
			},
			{ label: 'Open both', hint: hint('openBoth'), onClick: () => handleLaunch(p) },
			// a disabled entry says why: a grey line with no reason reads as
			// broken, not as a target that cannot open this project
			...targets.agents.map(t => {
				const missing =
					p.file_system === 'WSL' ? !t.wsl_executable : !t.executable;
				return {
					label: `Open in ${t.name}`,
					hint: missing
						? p.file_system === 'WSL'
							? 'no WSL form'
							: isMac
								? 'not found on this Mac'
								: 'not found on Windows'
						: t.id === targets.defaults.agent
							? hint('openAgent')
							: undefined,
					disabled: missing,
					onClick: () => openAgent(p, t.id).catch(e => toast(showError(e)))
				};
			}),
			// the row that says live gets the kill beside the reattach; the
			// palette had it, the row's own menu did not
			...(live
				? [{ label: 'Kill session', danger: true, onClick: () => killSession(p) }]
				: []),
			'separator',
			{
				label: labelFor('revealExplorer'),
				hint: hint('revealExplorer'),
				onClick: () => revealInExplorer(p)
			},
			{
				label: labelFor('copyWinPath'),
				hint: hint('copyWinPath'),
				onClick: () => copyWindowsPath(p)
			},
			...(isMac
				? []
				: [
						{
							label: labelFor('copyWslPath'),
							hint: hint('copyWslPath'),
							onClick: () => copyWslPath(p)
						} as MenuEntry
					]),
			...(remote
				? [
						{
							label: 'Open remote',
							hint: hint('openRemote'),
							onClick: () => handleOpenRemote(p)
						}
					]
				: []),
			'separator',
			{
				label: 'Run dev script…',
				hint: hint('runScript'),
				onClick: () => openScripts(p, menu?.x ?? 240, menu?.y ?? 200)
			},
			'separator',
			{
				label: pinned ? 'Unpin' : 'Pin to top',
				hint: hint('togglePin'),
				onClick: () => handleTogglePin(p)
			}
			// no workspace action here: the header's menu and delete
			// remove a workspace. a project's menu is about the project
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
			// same rule as delete: the workspace is the selected project's, and
			// the key says so when there is none
			if (
				fire('revealWorkspace', () => {
					if (!selected) {
						toast('Select a project first — the key reveals its workspace', 'info');
						return;
					}
					revealWorkspace(selected.workspace);
				})
			)
				return;
			// Delete is the one bare typing key in the table: in the search box it
			// deletes a character, and that stays the search box's.
			if (!isTypingTarget(e) && fire('removeWorkspace', handleRemoveShortcut))
				return;

			// the browser's refresh key, a table row like every other: matched
			// by hand here since 11, so settings › shortcuts never listed it
			if (fire('refreshAlt', handleRefresh)) return;

			if (!selected) return;
			if (fire('openEditor', () => handleOpenEditor())) return;
			if (fire('openTerminal', () => handleOpenTerminal())) return;
			if (fire('openBoth', handleOpenBoth)) return;
			if (targets.agents.length > 0 && fire('openAgent', () => handleOpenAgent()))
				return;
			if (fire('revealExplorer', () => revealInExplorer(selected))) return;
			if (fire('copyWinPath', () => copyWindowsPath(selected))) return;
			if (!isMac && fire('copyWslPath', () => copyWslPath(selected))) return;
			if (fire('runScript', () => openScripts(selected, 240, 200))) return;
			if (
				fire('openRemote', () => {
					if (git.get(selected.full_path)?.remote) handleOpenRemote(selected);
					else toast(`${selected.name} has no remote to open`, 'info');
				})
			)
				return;
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [selected, workspaces, git]);

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
					<FileSystems
						{...{
							runtime,
							wsl,
							onChanged: refreshWsl,
							onConfirm: (message: string, run: () => void) =>
								setConfirmAction({ message, run }),
							onResult: toast
						}}
					/>
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
						title={`Settings (${prettyKeys(shortcutFor('settings'))})`}
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
						onToggleHints: toggleHints,
						servers,
						onAddServer: () => setServerForm({}),
						onEditServer: (s: Server) => setServerForm({ initial: s }),
						onImportSsh: importSsh
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
								onClick: () => setGroupPicker({}),
								disabled: !hasRepos
							}
						],
						onClose: () => setGithubAddMenu(null)
					}}
				/>
			)}

			{serverMenu && (
				<ContextMenu
					{...{
						x: serverMenu.x,
						y: serverMenu.y,
						items: buildServerMenu(serverMenu.server),
						onClose: () => setServerMenu(null)
					}}
				/>
			)}

			{folderMenu && (
				<ContextMenu
					{...{
						x: folderMenu.x,
						y: folderMenu.y,
						items: buildFolderMenu(folderMenu.server, folderMenu.folder),
						onClose: () => setFolderMenu(null)
					}}
				/>
			)}
			{rootMenu && (
				<ContextMenu
					{...{
						x: rootMenu.x,
						y: rootMenu.y,
						items: buildRootMenu(rootMenu.server, rootMenu.root),
						onClose: () => setRootMenu(null)
					}}
				/>
			)}

			<Drawer
				{...{
					side: 'right' as const,
					open: rootPrompt !== null,
					title: rootPrompt
						? `List a folder at top level on ${rootPrompt.name}`
						: 'List a folder at top level',
					onClose: () => setRootPrompt(null)
				}}
			>
				{rootPrompt && (
					<NameDialog
						{...{
							hint: 'A folder on the server whose children become rows, beside ~ and /var/www: /etc, /opt, ~/some/place. Look inside any of them.',
							initial: '/etc',
							submitLabel: 'Add root',
							onSubmit: (root: string) => addRoot(rootPrompt, root),
							onDone: () => setRootPrompt(null)
						}}
					/>
				)}
			</Drawer>

			<Drawer
				{...{
					side: 'right' as const,
					open: actionForm !== null,
					title: actionForm ? actionForm.action.label.replace(/…$/, '') : '',
					onClose: () => setActionForm(null),
					width: 'w-[min(640px,92vw)]'
				}}
			>
				{actionForm && (
					<ActionForm
						{...{
							server: actionForm.server,
							action: actionForm.action,
							appDir: actionForm.appDir,
							initial: actionForm.initial,
							onRun: (values: Record<string, string>, preview: boolean) =>
								runServerAction(
									actionForm.server,
									actionForm.action,
									actionForm.appDir,
									values,
									preview
								),
							onDone: () => setActionForm(null)
						}}
					/>
				)}
			</Drawer>

			{serversAddMenu && (
				<ContextMenu
					{...{
						x: serversAddMenu.x,
						y: serversAddMenu.y,
						items: serversAddItems,
						onClose: () => setServersAddMenu(null)
					}}
				/>
			)}

			<Drawer
				{...{
					side: 'right' as const,
					open: serverForm !== null,
					title: serverForm?.initial
						? `Edit ${serverForm.initial.name}`
						: 'Add a server',
					onClose: () => setServerForm(null),
					width: 'w-[min(640px,92vw)]'
				}}
			>
				{serverForm && (
					<ServerForm
						{...{
							initial: serverForm.initial,
							onSubmit: saveServer,
							onDone: () => setServerForm(null)
						}}
					/>
				)}
			</Drawer>

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
					open: groupPicker !== null,
					title: 'Group repos',
					onClose: () => setGroupPicker(null),
					width: 'w-[min(640px,92vw)]'
				}}
			>
				{groupPicker !== null && (
					<ClonePicker
						{...{
							mode: 'group' as const,
							repos: github.payload?.cache.repos ?? [],
							local: github.payload?.local ?? {},
							workspaces,
							groups: github.groups,
							initialGroup: groupPicker.group,
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
							onDone: () => setGroupPicker(null)
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
						    rows' own three controls beside it. the box shares its line
						    with sort, + workspace and refresh and gives up width for
						    them; under 12rem it keeps its width and the three go under
						    it as one line (a narrow window left it a 127px slot) */}
						<div className='w-full shrink-0 flex items-start gap-4'>
						<div className='flex-1 min-w-0 flex flex-wrap items-center gap-3'>
							<SearchBox
								{...{
									ref: searchRef,
									value: query,
									onChange: setQuery,
									onEnter: handleSearchEnter,
									onArrow: handleArrow,
									enterHint:
										selected || filtered.length > 0 ? '⏎ Enter' : undefined,
									className: 'flex-1 min-w-[12rem]'
								}}
							/>
							<div className='flex items-center gap-3 shrink-0'>
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
								<RefreshIcon spinning={loading} />
							</Button>
							</div>
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
						{/* the buttons on the boxes' line: h-10 is a box's height, so they
						    stay centred on it when the project cell wraps to two lines */}
						<div className='h-10 flex items-center gap-4 shrink-0'>
						{github.available && (
							<GithubControls
								{...{
									github,
									onAddMenu: (x: number, y: number) => setGithubAddMenu({ x, y })
								}}
							/>
						)}
						{/* the servers' add beside the other adds (joy: "the +ADD should
						    go in the same line where other Adds go as Add Server") */}
						{servers.hasSsh && (
							<Button
								variant='ghost'
								className='gap-1 px-2 shrink-0'
								title='Add a server, or import ~/.ssh/config'
								onClick={e => {
									const r = e.currentTarget.getBoundingClientRect();
									setServersAddMenu({ x: r.left, y: r.bottom + 4 });
								}}
							>
								<span className='text-18 leading-none'>+</span>
								<span className='text-13 font-semibold leading-none'>
									Add server
								</span>
								<span className='text-11 leading-none opacity-70'>▾</span>
							</Button>
						)}
						</div>
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
								servers,
								onServerOpen: openServer,
								onServerContextMenu: (s: Server, x: number, y: number) =>
									setServerMenu({ server: s, x, y }),
								onServersAddMenu: (x: number, y: number) =>
									setServersAddMenu({ x, y }),
								onFolderOpen: openFolder,
								onFolderContextMenu: (
									s: Server,
									f: RemoteFolder,
									x: number,
									y: number
								) => setFolderMenu({ server: s, folder: f, x, y }),
								onRootContextMenu: (s: Server, root: string, x: number, y: number) =>
									setRootMenu({ server: s, root, x, y }),
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
					agents: targets.agents,
					defaults: targets.defaults,
					onEditor: handleOpenEditor,
					onTerminal: handleOpenTerminal,
					onAgent: handleOpenAgent,
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
