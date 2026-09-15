import { useEffect, useImperativeHandle, useState } from 'react';
import Button from './Button';

const col = 'grid grid-cols-[1fr_1fr_80px_52px] items-center text-sm';

const COLUMNS = [
	{ label: 'Workspace', className: '' },
	{ label: 'Location', className: '' },
	{ label: 'File System', className: '' },
	{ label: 'Count', className: 'text-right' }
];

const lastSegment = (path: string) =>
	path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;

const pill =
	'inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-bg-panel border border-border shrink-0';

const REASON_LABEL: Record<UnavailableReason, string> = {
	distro_stopped: 'WSL stopped',
	not_mounted: 'not mounted',
	access_denied: 'no access'
};

const StatusPill = ({ state }: StatusPillProps) => {
	if (!state || state.status === 'live') return null;
	const label = state.reason ? REASON_LABEL[state.reason] : 'unavailable';
	const cached = state.status === 'cached';
	return (
		<span
			className={`${pill} ${cached ? 'text-text-muted' : 'text-danger'}`}
			title={
				cached ? `Showing cached projects — ${label}` : `Unavailable — ${label}`
			}
		>
			{cached ? `cached · ${label}` : label}
		</span>
	);
};

/// Branch name plus a dot when the tree is dirty. Absent entirely for anything
/// that is not a git repository, or whose distro is stopped — no placeholder,
/// no "unknown", nothing to read as a state that it isn't.
const GitBadge = ({ info, onOpenRemote }: GitBadgeProps) => {
	if (!info?.branch) return null;
	return (
		<span className='flex items-center gap-1 min-w-0'>
			{info.dirty && (
				<span className='text-amber-400 leading-none' title='Uncommitted changes'>
					●
				</span>
			)}
			<span
				className={`truncate font-mono text-[11px] text-text-muted ${
					info.remote ? 'hover:text-accent cursor-pointer' : ''
				}`}
				title={info.remote ? `${info.branch} — open ${info.remote}` : info.branch}
				onClick={
					info.remote
						? e => {
								e.stopPropagation();
								onOpenRemote?.();
							}
						: undefined
				}
			>
				{info.branch}
			</span>
		</span>
	);
};

/// The right-hand cell of a project row: git state, frecency hint, pin star.
const RowMeta = ({
	project,
	rank,
	git,
	onTogglePin,
	onOpenRemote
}: RowMetaProps) => (
	<div className='flex items-center justify-end gap-1.5 min-w-0'>
		<GitBadge {...{ info: git, onOpenRemote: () => onOpenRemote?.(project) }} />
		{rank?.hint && (
			<span className='text-[9px] uppercase tracking-wider text-text-muted shrink-0'>
				{rank.hint}
			</span>
		)}
		{onTogglePin && (
			<Button
				variant='ghost'
				className={`text-xs leading-none p-0.5 hover:scale-110 hover:bg-transparent ${
					rank?.pinned ? 'text-accent' : 'text-text-muted/40'
				}`}
				title={rank?.pinned ? 'Unpin' : 'Pin to top'}
				onClick={e => {
					// The row itself selects on click; pinning must not also select.
					e.stopPropagation();
					onTogglePin(project);
				}}
			>
				{rank?.pinned ? '★' : '☆'}
			</Button>
		)}
	</div>
);

/// One project row — the same element whether it sits in the Pinned strip or
/// under its workspace header; only the left border and the dimming differ.
const ProjectRow = ({
	project,
	selected,
	pinnedStrip,
	stale,
	rank,
	git,
	onSelect,
	onDoubleClick,
	onTogglePin,
	onOpenRemote
}: ProjectRowProps) => (
	<div
		className={`${col} px-3 py-1.5 cursor-pointer select-none transition-colors ${
			pinnedStrip ? 'border-l-2' : 'ml-6 border-l border-border'
		} ${stale ? 'opacity-60' : ''} ${
			selected
				? 'bg-bg-selected text-text-primary border-l-accent'
				: `text-text-secondary hover:bg-bg-hover/50 ${
						pinnedStrip ? 'border-l-accent/40' : 'border-l-transparent'
					}`
		}`}
		onClick={() => onSelect(project)}
		onDoubleClick={() => onDoubleClick(project)}
	>
		<div className='truncate text-text-muted' title={project.workspace}>
			{lastSegment(project.workspace)}
		</div>
		<div
			className={`font-medium font-mono truncate ${selected ? 'text-text-primary' : ''}`}
		>
			{project.name}
		</div>
		<div
			className={
				project.file_system === 'WSL' ? 'text-accent' : 'text-text-muted'
			}
		>
			{project.file_system}
		</div>
		<RowMeta {...{ project, rank, git, onTogglePin, onOpenRemote }} />
	</div>
);

const ProjectTree = ({
	projects,
	selected,
	onSelect,
	onDoubleClick,
	onLaunch,
	query,
	loading,
	workspaceStates,
	ranks,
	gitInfo,
	pinnedProjects,
	onTogglePin,
	onOpenRemote,
	ref
}: ProjectTreeProps) => {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const grouped = new Map<string, Project[]>();
	for (const p of projects) {
		const existing = grouped.get(p.workspace) ?? [];
		existing.push(p);
		grouped.set(p.workspace, existing);
	}

	// Pinned rows come first for keyboard navigation, and are then skipped in
	// the tree below so arrowing down never lands on the same project twice.
	const pinned = pinnedProjects ?? [];
	const pinnedPaths = new Set(pinned.map(p => p.full_path));

	const visible: Project[] = [...pinned];
	for (const [ws, wsProjects] of grouped) {
		if (!collapsed.has(ws)) {
			visible.push(...wsProjects.filter(p => !pinnedPaths.has(p.full_path)));
		}
	}

	const navigate = (dir: 1 | -1) => {
		const idx = visible.findIndex(p => p.full_path === selected?.full_path);
		const next = idx === -1 ? visible[0] : visible[idx + dir];
		if (next) onSelect(next);
	};

	useImperativeHandle(ref, () => ({ navigate }));

	// Searching expands everything; otherwise only the selected workspace stays
	// open. Both were effects that called setCollapsed synchronously, which
	// cascades an extra render on every keystroke. This is React's documented
	// "adjust state while rendering" pattern instead: recompute the moment the
	// inputs actually change, and leave manual toggles alone in between.
	const derivedKey = `${query.trim() ? 'search' : 'browse'}|${
		selected?.workspace ?? ''
	}|${[...grouped.keys()].join('')}`;
	const [lastKey, setLastKey] = useState(derivedKey);
	if (derivedKey !== lastKey) {
		setLastKey(derivedKey);
		setCollapsed(() => {
			if (query.trim()) return new Set<string>();
			const next = new Set<string>();
			for (const [ws] of grouped) {
				if (ws !== selected?.workspace) next.add(ws);
			}
			return next;
		});
	}

	useEffect(() => {
		const launch = () => {
			if (selected) onLaunch(selected);
			else if (visible.length > 0) onLaunch(visible[0]);
		};
		const keys: Record<string, () => void> = {
			ArrowDown: () => navigate(1),
			ArrowUp: () => navigate(-1),
			Enter: launch
		};
		const handler = (e: globalThis.KeyboardEvent) => {
			// Bare keys belong to whatever input has focus, but modifier combos are
			// app-level and must still work while the search box is focused —
			// which is exactly where summon leaves you.
			const mod = e.ctrlKey || e.metaKey;
			const modified = mod || e.altKey;
			if (e.target instanceof HTMLInputElement && !modified) return;
			if (modified) {
				// Ctrl+S rather than bare "s": the search box is the primary input,
				// and a bare letter is unreachable while it has focus.
				if (mod && e.key === 's' && selected) {
					e.preventDefault();
					onTogglePin?.(selected);
				}
				return;
			}
			const action = keys[e.key];
			if (!action) return;
			e.preventDefault();
			action();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [selected, visible, navigate, onLaunch, onTogglePin]);

	const stateFor = (ws: string) =>
		workspaceStates?.find(s => s.workspace === ws);

	const toggle = (ws: string) => {
		setCollapsed(prev => {
			const next = new Set(prev);
			if (next.has(ws)) next.delete(ws);
			else next.add(ws);
			return next;
		});
	};

	if (loading) {
		return (
			<div className='flex-1 flex items-center justify-center text-sm text-text-muted'>
				<span className='animate-spin text-lg mr-2'>&#9696;</span>
				Scanning workspaces...
			</div>
		);
	}

	if (projects.length === 0) {
		// "Nothing configured" and "everything is offline right now" are very
		// different situations and must never look the same.
		const blocked =
			workspaceStates?.filter(s => s.status === 'unavailable') ?? [];
		if (blocked.length > 0) {
			return (
				<div className='flex-1 flex flex-col items-center justify-center gap-2 text-sm text-text-muted px-6 text-center'>
					<span className='text-danger font-semibold'>
						{blocked.length === 1
							? '1 workspace is unavailable'
							: `All ${blocked.length} workspaces are unavailable`}
					</span>
					{blocked.map(s => (
						<span
							key={s.workspace}
							className='font-mono text-xs truncate max-w-full'
						>
							{s.workspace} —{' '}
							{s.reason ? REASON_LABEL[s.reason] : 'unavailable'}
						</span>
					))}
					<span className='text-xs'>
						Nothing was cached for these yet. Refresh once they are back.
					</span>
				</div>
			);
		}
		return (
			<div className='flex-1 flex items-center justify-center text-sm text-text-muted'>
				No projects found. Add a workspace to begin.
			</div>
		);
	}

	const workspaces = [...grouped.entries()];

	const rowProps = (project: Project) => ({
		project,
		selected: selected?.full_path === project.full_path,
		rank: ranks?.get(project.full_path),
		git: gitInfo?.get(project.full_path),
		onSelect,
		onDoubleClick,
		onTogglePin,
		onOpenRemote
	});

	return (
		<div className='flex-1 flex flex-col min-h-0'>
			<div
				className={`${col} px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-text-primary bg-bg-hover/30 rounded-t-md shrink-0 border-b border-border`}
			>
				{COLUMNS.map(({ label, className }) => (
					<div key={label} className={className}>
						{label}
					</div>
				))}
			</div>

			<div className='flex-1 overflow-y-auto'>
				{pinned.length > 0 && (
					<div className='mb-1'>
						<div className='px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted'>
							Pinned
						</div>
						{pinned.map(project => (
							<ProjectRow
								key={`pinned-${project.full_path}`}
								{...{ ...rowProps(project), pinnedStrip: true }}
							/>
						))}
						<div className='mx-3 my-1 border-b border-border' />
					</div>
				)}

				{workspaces.map(([ws, wsProjects]) => {
					const isOpen = !collapsed.has(ws);
					const count = wsProjects.length;
					const fs = wsProjects[0]?.file_system ?? 'Windows';
					const wsState = stateFor(ws);
					const isStale = wsState?.status === 'cached';

					return (
						<div key={ws}>
							<div
								className={`${col} px-3 py-2 cursor-pointer hover:bg-bg-hover/50 select-none`}
								onClick={() => toggle(ws)}
								title={ws}
							>
								<div className='flex items-center gap-2 text-text-secondary min-w-0'>
									<span
										className={`text-xs shrink-0 ${isOpen ? 'text-accent' : 'text-text-muted'}`}
									>
										{isOpen ? '▼' : '▶'}
									</span>
									<span className='truncate font-semibold text-text-primary'>
										{lastSegment(ws)}
									</span>
									<StatusPill state={wsState} />
								</div>
								<div className='text-text-muted truncate' title={ws}>
									{ws}
								</div>
								<div
									className={`font-medium ${fs === 'WSL' ? 'text-accent' : 'text-text-muted'}`}
								>
									{fs}
								</div>
								<div className='text-right text-text-muted font-mono'>
									{count}
								</div>
							</div>

							{isOpen &&
								wsProjects
									.filter(p => !pinnedPaths.has(p.full_path))
									.map(project => (
										<ProjectRow
											key={project.full_path}
											{...{ ...rowProps(project), stale: isStale }}
										/>
									))}
						</div>
					);
				})}
			</div>
		</div>
	);
};

export default ProjectTree;
