import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import ActionButtons from './components/ActionButtons';
import Button from './components/Button';
import ConfirmDialog from './components/ConfirmDialog';
import ProjectTree from './components/ProjectTree';
import RuntimeIndicator from './components/RuntimeIndicator';
import SearchBox from './components/SearchBox';
import TitleBar from './components/TitleBar';
import ToastProvider, { useToast } from './components/Toast';
import { useLaunchActions } from './hooks/useLaunchActions';
import { useProjects } from './hooks/useProjects';
import { useRuntime } from './hooks/useRuntime';
import { useWorkspaces } from './hooks/useWorkspaces';

const WorkspaceManager = lazy(() => import('./components/WorkspaceManager'));

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
	const { workspaces } = useWorkspaces();
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
		pinnedProjects,
		sortMode,
		toggleSort,
		togglePin
	} = useProjects();
	const {
		showWorkspaces,
		setShowWorkspaces,
		addWorkspace,
		removeWorkspace,
		openVSCode,
		openTerminal,
		openBoth
	} = useLaunchActions(selected, refresh);
	const { toast } = useToast();
	const [removeIndex, setRemoveIndex] = useState<number | null>(null);

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

	const handleSelect = (p: Project) => setSelected(p);

	const handleLaunch = (p: Project) => {
		setSelected(p);
		openBoth(p).catch(e => toast(showError(e)));
	};

	const handleSearchEnter = () => {
		const target = selected ?? filtered[0];
		if (target) handleLaunch(target);
	};

	const handleRemove = async (index: number) => {
		try {
			await removeWorkspace(index);
		} catch (e) {
			toast(showError(e));
		}
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

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			if (e.key === 'F5' || (mod && e.key === 'r')) {
				e.preventDefault();
				handleRefresh();
			} else if (mod && e.key === 'q') {
				e.preventDefault();
				invoke('quit_app').catch(() => {});
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, []);

	const handleTogglePin = (p: Project) => {
		togglePin(p).catch(e => toast(showError(e)));
	};

	const handleOpenVSCode = () => openVSCode().catch(e => toast(showError(e)));
	const handleOpenTerminal = () =>
		openTerminal().catch(e => toast(showError(e)));
	const handleOpenBoth = () => openBoth().catch(e => toast(showError(e)));

	return (
		<div className='flex flex-col h-screen w-screen rounded-xl overflow-hidden'>
			<TitleBar>
				<RuntimeIndicator runtime={runtime?.runtime ?? 'windows'} />
			</TitleBar>

			{showWorkspaces && (
				<div
					className='fixed inset-0 bg-black/60 flex items-center justify-center z-40'
					onClick={() => setShowWorkspaces(false)}
				>
					<div
						className='bg-bg-secondary border border-border rounded-xl p-6 w-screen h-screen min-w-md overflow-y-auto shadow-2xl'
						onClick={e => e.stopPropagation()}
					>
						<Suspense>
							<WorkspaceManager
								{...{
									workspaces,
									onAdd: addWorkspace,
									onRemove: (i: number) => setRemoveIndex(i)
								}}
							/>
						</Suspense>
						<Button
							className='w-full mt-4'
							onClick={() => setShowWorkspaces(false)}
						>
							Close
						</Button>
					</div>
				</div>
			)}

			<ConfirmDialog
				{...{
					open: removeIndex !== null,
					title: 'Remove Workspace',
					message:
						'Are you sure you want to remove this workspace folder? Your files will not be deleted.',
					onConfirm: () => {
						if (removeIndex !== null) handleRemove(removeIndex);
						setRemoveIndex(null);
					},
					onCancel: () => setRemoveIndex(null)
				}}
			/>

			<div className='flex-1 flex flex-col p-5 gap-4 overflow-hidden'>
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
						pinnedProjects,
						onTogglePin: handleTogglePin
					}}
				/>
				<ActionButtons
					{...{
						hasSelection: selected !== null,
						onAddWorkspace: () => setShowWorkspaces(true),
						onRemoveWorkspace: () => setShowWorkspaces(true),
						onVSCode: handleOpenVSCode,
						onTerminal: handleOpenTerminal,
						onBoth: handleOpenBoth,
						onRefresh: handleRefresh
					}}
				/>
			</div>
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
