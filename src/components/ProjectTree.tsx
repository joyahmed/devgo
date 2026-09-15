import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { lastSegment } from '../paths';
import { isTypingTarget, matches, shortcutFor } from '../shortcuts';
import Button from './Button';
import GithubLane from './GithubLane';
import { col } from './rowStyles';

const COLUMNS = [
	{ label: 'Workspace', className: '' },
	{ label: 'Location', className: '' },
	{ label: 'File System', className: '' },
	{ label: 'Count', className: 'text-right' }
];

// the collapse set is the user's, saved; search is a view on top of it
const COLLAPSED_KEY = 'devgo.collapsed';
// pixels of travel before a press on a header becomes a drag
const DRAG_THRESHOLD = 4;

const loadCollapsed = (): Set<string> => {
	try {
		const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
		return new Set(Array.isArray(raw) ? (raw as string[]) : []);
	} catch {
		return new Set();
	}
};

const pill =
	'inline-block px-2 py-0.5 text-11 font-semibold rounded-full bg-bg-panel border border-border-strong shrink-0';

const FS_TONE: Record<string, string> = {
	WSL: 'text-accent',
	Network: 'text-amber-400'
};

// the group's rail: a 2px rule the height of its rows in the file
// system's hue, the one FsCell uses. it replaces the per-row guide that
// flipped to accent on selection; the rail belongs to the group, and
// selection is the row's ground and its name
const RAIL: Record<string, string> = {
	WSL: 'border-l-accent/50',
	Network: 'border-l-amber-400/50',
	Windows: 'border-l-text-muted/40'
};

const NETWORK_WARNING =
	'On a network share — file access and dev tooling are slow here. Consider a local drive or a WSL-native path.';

const FsCell = ({ fs, className = '' }: FsCellProps) => (
	<div
		className={`${FS_TONE[fs] ?? 'text-text-muted'} ${className}`.trim()}
		title={fs === 'Network' ? NETWORK_WARNING : undefined}
	>
		{fs}
		{fs === 'Network' && ' ⚠'}
	</div>
);

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

/// Stack colours — the ecosystems' own, so a badge is recognised without being
/// read. Anything unlisted renders muted rather than being dropped: a new
/// marker should show up as a plain badge, not vanish.
const TAG_TONE: Record<string, string> = {
	turbo: 'text-fuchsia-300',
	next: 'text-slate-200',
	rust: 'text-orange-300',
	go: 'text-cyan-300',
	python: 'text-yellow-300',
	docker: 'text-blue-300',
	node: 'text-green-300'
};

/// Stack badges, plus a marker when dependencies are not installed.
///
/// words, not pills: NODE BUN in bordered boxes read as two buttons on
/// every row, a column of chips down forty rows. the hue carries the
/// identity; the border carried nothing.
///
/// The missing-deps dot is the one piece of judgement here: a Node or Rust
/// project with no node_modules or target is one you cannot actually run yet,
/// and that is worth knowing before you open it. Docker-only projects are
/// exempt — their dependencies live in an image, and a warning that can never
/// be cleared is one you learn to ignore.
const TechBadges = ({ tech }: TechBadgesProps) => {
	if (!tech || tech.tags.length === 0) return null;
	const runnable = tech.tags.some(t => t !== 'docker');
	return (
		<span className='flex items-center gap-1 shrink-0'>
			{tech.tags.map(t => (
				<span
					key={t}
					className={`text-11 font-mono ${TAG_TONE[t] ?? 'text-text-muted'}`}
				>
					{t}
				</span>
			))}
			{tech.package_manager && (
				<span className='text-11 font-mono text-text-muted'>
					{tech.package_manager}
				</span>
			)}
			{runnable && !tech.has_deps && (
				<span
					className='text-text-muted leading-none'
					title='Dependencies do not appear to be installed'
				>
					○
				</span>
			)}
		</span>
	);
};

/// Branch name plus a dot when the tree is dirty. Absent entirely for anything
/// that is not a git repository, or whose distro is stopped — no placeholder,
/// no "unknown", nothing to read as a state that it isn't. With a remote the
/// chip is a door: it reports where it is and asks for the branch popover
/// there, so the list appears where the eye already is.
const GitBadge = ({ info, onOpenBranches }: GitBadgeProps) => {
	if (!info?.branch) return null;
	return (
		<span className='flex items-center gap-1 min-w-0'>
			{info.dirty && (
				<span className='text-amber-400 leading-none' title='Uncommitted changes'>
					●
				</span>
			)}
			<span
				className={`truncate font-mono text-11 text-text-muted ${
					info.remote ? 'hover:text-accent cursor-pointer' : ''
				}`}
				title={
					info.remote ? `${info.branch} — branches on ${info.remote}` : info.branch
				}
				onClick={
					info.remote
						? e => {
								e.stopPropagation();
								const r = e.currentTarget.getBoundingClientRect();
								onOpenBranches?.(r.left, r.bottom + 4);
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
	showHints,
	rank,
	git,
	tech,
	onTogglePin,
	onOpenBranches
}: RowMetaProps) => (
	<div className='flex items-center justify-end gap-1.5 min-w-0'>
		<TechBadges {...{ tech }} />
		<GitBadge
			{...{
				info: git,
				onOpenBranches: (x: number, y: number) => onOpenBranches?.(project, x, y)
			}}
		/>
		{/* recent / frequent: off unless Appearance says otherwise. the
		    frecency sort already puts them first, and they were the fourth
		    item in a five-item cluster on every row */}
		{showHints && rank?.hint && (
			<span className='text-11 text-text-muted shrink-0'>
				{rank.hint}
			</span>
		)}
		{/* ☆ on hover only, ★ always: forty hollow stars down the table were
		    a column of nothing, and the pinned ones are the information */}
		{onTogglePin && (
			<Button
				variant='ghost'
				className={`text-13 leading-none p-0.5 hover:scale-110 hover:bg-transparent transition-opacity ${
					rank?.pinned
						? 'text-accent'
						: 'text-text-muted/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
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
/// under its workspace header; only the dimming differs.
const ProjectRow = ({
	project,
	selected,
	stale,
	quiet,
	showHints,
	launching,
	rank,
	git,
	tech,
	onSelect,
	onDoubleClick,
	onTogglePin,
	onOpenBranches,
	onContextMenu
}: ProjectRowProps) => (
	<div
		className={`${col} group px-3 py-1.5 cursor-pointer select-none transition-colors ${
			stale ? 'opacity-60' : ''
		} ${launching ? 'animate-launch' : ''} ${
			selected
				? quiet
					? 'bg-bg-selected/40 text-text-primary'
					: 'bg-bg-selected text-text-primary'
				: 'text-text-secondary hover:bg-bg-hover/50'
		}`}
		onClick={() => onSelect(project)}
		onDoubleClick={() => onDoubleClick(project)}
		// select first so the menu and the keyboard agree on the row
		onContextMenu={e => {
			e.preventDefault();
			onSelect(project);
			onContextMenu?.(project, e.clientX, e.clientY);
		}}
	>
		<div className='truncate text-text-muted' title={project.workspace}>
			{lastSegment(project.workspace)}
		</div>
		<div
			className={`font-medium font-mono truncate ${selected ? 'text-text-primary' : ''}`}
		>
			{project.name}
		</div>
		<FsCell fs={project.file_system} />
		<RowMeta
			{...{ project, showHints, rank, git, tech, onTogglePin, onOpenBranches }}
		/>
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
	techInfo,
	pinnedProjects,
	onTogglePin,
	onOpenBranches,
	onContextMenu,
	onWorkspaceContextMenu,
	workspaceOrder,
	onReorder,
	github,
	onRepoOpen,
	onRepoContextMenu,
	onShowLocal,
	cloneJobs,
	onGithubAddMenu,
	onGroupContextMenu,
	showHints,
	launchingPath,
	ref
}: ProjectTreeProps) => {
	const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
	// a repo row under the cursor: not a Project, so never selected, but
	// reachable by arrow. beside the selection, and any change of the
	// selection drops it, so the two are never lit at once
	const [repoCursor, setRepoCursor] = useState<string | null>(null);
	useEffect(() => setRepoCursor(null), [selected]);
	const searching = query.trim().length > 0;
	const isCollapsed = (ws: string) => !searching && collapsed.has(ws);

	const grouped = new Map<string, Project[]>();
	for (const p of projects) {
		const existing = grouped.get(p.workspace) ?? [];
		existing.push(p);
		grouped.set(p.workspace, existing);
	}

	// the store's order, not grouped's: grouped is keyed in first-seen order
	// of the name-sorted project list, so a workspace's place depended on
	// what its first project happened to be called. one the store does not
	// list (a search result from a workspace mid-removal) keeps its place
	// at the end rather than vanishing
	const rank = new Map((workspaceOrder ?? []).map((w, i) => [w, i]));
	const at = (ws: string) => rank.get(ws) ?? Number.MAX_SAFE_INTEGER;
	const entries = [...grouped].sort(([a], [b]) => at(a) - at(b));

	// move ws to sit before or after target and hand back the whole order:
	// the store can check a permutation, it cannot check a move
	const moveWorkspace = (ws: string, target: string, after: boolean) => {
		if (!onReorder || ws === target) return;
		const without = (workspaceOrder ?? []).filter(w => w !== ws);
		const i = without.indexOf(target);
		if (i < 0) return;
		without.splice(after ? i + 1 : i, 0, ws);
		onReorder(without);
	};

	// pointer events, not the html5 drag api: tauri owns os drag-drop on
	// this window (that is how a dropped folder becomes a workspace), and on
	// windows that swallows every dragstart in the webview. press, move
	// past a threshold, follow the pointer with elementFromPoint, release
	const [dragging, setDragging] = useState<string | null>(null);
	const [drop, setDrop] = useState<{ ws: string; after: boolean } | null>(
		null
	);
	const drag = useRef<{ ws: string; startY: number; active: boolean } | null>(
		null
	);
	// a finished drag ends with a pointerup on the header, and the browser
	// follows it with a click, which toggles the workspace; eat that one
	const swallowClick = useRef(false);

	const dropTargetAt = (x: number, y: number) => {
		const el = document
			.elementFromPoint(x, y)
			?.closest<HTMLElement>('[data-ws-header]');
		if (!el) return null;
		const r = el.getBoundingClientRect();
		// which half of the row decides before or after, so the line is honest
		return { ws: el.dataset.wsHeader ?? '', after: y > r.top + r.height / 2 };
	};

	const headerPointerDown = (
		e: React.PointerEvent<HTMLDivElement>,
		ws: string
	) => {
		if (!onReorder || e.button !== 0) return;
		drag.current = { ws, startY: e.clientY, active: false };
	};

	const headerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d) return;
		if (!d.active) {
			if (Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD) return;
			d.active = true;
			setDragging(d.ws);
			// keeps the moves coming after the pointer leaves the header
			e.currentTarget.setPointerCapture(e.pointerId);
		}
		const t = dropTargetAt(e.clientX, e.clientY);
		const next = t && t.ws !== d.ws ? t : null;
		setDrop(prev =>
			prev?.ws === next?.ws && prev?.after === next?.after ? prev : next
		);
	};

	const endDrag = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
		const d = drag.current;
		drag.current = null;
		if (!d?.active) return;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		swallowClick.current = true;
		if (commit) {
			const t = dropTargetAt(e.clientX, e.clientY);
			if (t && t.ws !== d.ws) moveWorkspace(d.ws, t.ws, t.after);
		}
		setDragging(null);
		setDrop(null);
	};

	// the keyboard twin of dragging the header: the selected project's
	// workspace moves one place in the rendered order
	const nudge = (ws: string, dir: 1 | -1) => {
		const i = entries.findIndex(([w]) => w === ws);
		const target = entries[i + dir];
		if (i >= 0 && target) moveWorkspace(ws, target[0], dir === 1);
	};

	// Pinned rows come first for keyboard navigation, and are then skipped in
	// the tree below so arrowing down never lands on the same project twice.
	const pinned = pinnedProjects ?? [];
	const pinnedPaths = new Set(pinned.map(p => p.full_path));

	const visible: Project[] = [...pinned];
	for (const [ws, wsProjects] of entries) {
		if (!isCollapsed(ws)) {
			visible.push(...wsProjects.filter(p => !pinnedPaths.has(p.full_path)));
		}
	}

	// the navigable sequence in the order the rows render: the projects
	// above, then the github rows when that group is open
	const rows: NavRow[] = visible.map(project => ({ kind: 'project', project }));
	for (const repo of github?.isOpen ? github.visible : []) {
		rows.push({ kind: 'repo', repo });
	}

	const selectProject = (p: Project) => {
		setRepoCursor(null);
		onSelect(p);
	};
	const selectRepo = (r: GithubRepo) => setRepoCursor(r.full_name);
	const land = (row: NavRow) => {
		if (row.kind === 'project') selectProject(row.project);
		else selectRepo(row.repo);
	};

	// from the github box the arrows walk the github rows and nothing
	// else, the way the project box's arrows have always started at the
	// projects; the walk is narrowed, the cursor is the same
	const navigate = (dir: 1 | -1, lane: SearchLane = 'projects') => {
		const walk = lane === 'github' ? rows.filter(r => r.kind === 'repo') : rows;
		const idx = repoCursor
			? walk.findIndex(r => r.kind === 'repo' && r.repo.full_name === repoCursor)
			: walk.findIndex(
					r => r.kind === 'project' && r.project.full_path === selected?.full_path
				);
		const next = idx === -1 ? walk[0] : walk[idx + dir];
		if (next) land(next);
	};

	const openRepo = () => {
		const repo = github?.visible.find(r => r.full_name === repoCursor);
		if (!repo) return false;
		onRepoOpen?.(repo);
		return true;
	};

	useImperativeHandle(ref, () => ({ navigate, openRepo }));

	// Takes the state wanted rather than toggling: → always expands and ←
	// always collapses, and only Ctrl+Space computes the flip, at its call site.
	const setCollapsedFor = (ws: string, want: boolean) => {
		setCollapsed(prev => {
			const next = new Set(prev);
			if (want) next.add(ws);
			else next.delete(ws);
			localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
			return next;
		});
	};

	// Reads `rows` — the flattened, filtered list on screen — so Home and
	// End land on what you can see, not on the unfiltered project set.
	const jump = (to: 'top' | 'bottom') => {
		const target = to === 'top' ? rows[0] : rows[rows.length - 1];
		if (target) land(target);
	};

	useEffect(() => {
		const launch = () => {
			if (selected) onLaunch(selected);
			else if (visible.length > 0) onLaunch(visible[0]);
		};
		const ws = selected?.workspace;
		// Bare navigation keys. While the search box has focus these belong to
		// it — it forwards ↑ ↓ ⏎ itself, and ← → Home End move its caret.
		const walk: Record<string, () => void> = {
			ArrowDown: () => navigate(1),
			ArrowUp: () => navigate(-1),
			Home: () => jump('top'),
			End: () => jump('bottom')
		};
		// a repo under the cursor: enter opens its page, and the workspace
		// keys are off since there is nothing to collapse
		const keys: Record<string, () => void> = repoCursor
			? { ...walk, Enter: () => openRepo() }
			: {
					...walk,
					ArrowRight: () => ws && setCollapsedFor(ws, false),
					ArrowLeft: () => ws && setCollapsedFor(ws, true),
					Enter: launch
				};
		// Modifier combos are app-level and must still work while the search
		// box is focused — which is exactly where summon leaves you. A bare
		// letter is unreachable there, which is why every project action is
		// a combo.
		const combos: [ShortcutId, () => void][] = [
			['togglePin', () => selected && onTogglePin?.(selected)],
			['toggleWorkspace', () => ws && setCollapsedFor(ws, !isCollapsed(ws))],
			['moveWorkspaceUp', () => ws && nudge(ws, -1)],
			['moveWorkspaceDown', () => ws && nudge(ws, 1)]
		];
		const handler = (e: globalThis.KeyboardEvent) => {
			const modified = e.ctrlKey || e.metaKey || e.altKey;
			// Enter combos are project actions, owned by App's handler. Two
			// window listeners see every key; one of them renouncing the overlap
			// is what keeps the boundary from being a coin flip on effect order.
			if (e.key === 'Enter' && (modified || e.shiftKey)) return;
			if (modified) {
				const combo = combos.find(([id]) => matches(e, shortcutFor(id)));
				if (!combo) return;
				e.preventDefault();
				combo[1]();
				return;
			}
			if (isTypingTarget(e)) return;
			const action = keys[e.key];
			if (!action) return;
			e.preventDefault();
			action();
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [
		selected,
		rows,
		repoCursor,
		collapsed,
		navigate,
		onLaunch,
		onTogglePin,
		onRepoOpen,
		workspaceOrder,
		onReorder
	]);

	const stateFor = (ws: string) =>
		workspaceStates?.find(s => s.workspace === ws);

	const toggle = (ws: string) => setCollapsedFor(ws, !isCollapsed(ws));

	if (loading) {
		return (
			<div className='flex-1 flex items-center justify-center text-15 text-text-muted'>
				<span className='animate-spin text-18 mr-2'>&#9696;</span>
				Scanning workspaces...
			</div>
		);
	}

	const githubLane = github?.available ? (
		<GithubLane
			{...{
				github,
				cursor: repoCursor,
				onSelect: selectRepo,
				onOpen: (r: GithubRepo) => onRepoOpen?.(r),
				onContextMenu: (r: GithubRepo, x: number, y: number) =>
					onRepoContextMenu?.(r, x, y),
				onShowLocal: (path: string) => onShowLocal?.(path),
				jobs: cloneJobs,
				onAddMenu: onGithubAddMenu,
				onGroupContextMenu
			}}
		/>
	) : null;

	if (projects.length === 0) {
		// "Nothing configured" and "everything is offline right now" are very
		// different situations and must never look the same.
		const blocked =
			workspaceStates?.filter(s => s.status === 'unavailable') ?? [];
		if (blocked.length > 0) {
			return (
				<div className='flex-1 flex flex-col items-center justify-center gap-2 text-15 text-text-muted px-6 text-center'>
					<span className='text-danger font-semibold'>
						{blocked.length === 1
							? '1 workspace is unavailable'
							: `All ${blocked.length} workspaces are unavailable`}
					</span>
					{blocked.map(s => (
						<span
							key={s.workspace}
							className='font-mono text-13 truncate max-w-full'
						>
							{s.workspace} —{' '}
							{s.reason ? REASON_LABEL[s.reason] : 'unavailable'}
						</span>
					))}
					<span className='text-13'>
						Nothing was cached for these yet. Refresh once they are back.
					</span>
				</div>
			);
		}
		if (!githubLane) {
			return (
				<div className='flex-1 flex items-center justify-center text-15 text-text-muted'>
					No projects found. Add a workspace to begin.
				</div>
			);
		}
		// a query no project matches may still have an answer in the github
		// rows, which is half of why they are here: the empty line is a
		// line, not the whole screen, when there is a group to show under it
		return (
			<div className='flex-1 flex flex-col min-h-0'>
				<div className='flex-1 overflow-y-auto'>
					<div className='px-3 py-3 text-15 text-text-muted'>
						{query.trim()
							? 'No project matches.'
							: 'No projects found. Add a workspace to begin.'}
					</div>
					{githubLane}
				</div>
			</div>
		);
	}

	// two cursors can be lit at once, the project you selected and the
	// github row you then arrowed to, and enter acts on the second. a
	// cursor whose row has left the list (the box was cleared) lights
	// nothing, so it dims nothing
	const cursorLit = rows.some(
		r => r.kind === 'repo' && r.repo.full_name === repoCursor
	);
	const rowProps = (project: Project) => ({
		project,
		selected: selected?.full_path === project.full_path,
		quiet: cursorLit,
		showHints,
		launching: launchingPath === project.full_path,
		rank: ranks?.get(project.full_path),
		git: gitInfo?.get(project.full_path),
		tech: techInfo?.get(project.full_path),
		onSelect: selectProject,
		onDoubleClick,
		onTogglePin,
		onOpenBranches,
		onContextMenu
	});

	return (
		<div className='flex-1 flex flex-col min-h-0'>
			<div
				className={`${col} px-3 py-1.5 text-13 font-bold uppercase tracking-wider text-text-primary bg-bg-hover/30 rounded-t-control shrink-0 border-b border-border`}
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
						<div className='px-3 py-1 text-13 font-semibold text-text-muted'>
							Pinned
						</div>
						<div className='border-l-2 border-l-accent/40'>
							{pinned.map(project => (
								<ProjectRow
									key={`pinned-${project.full_path}`}
									{...rowProps(project)}
								/>
							))}
						</div>
						<div className='mx-3 my-1 border-b border-border' />
					</div>
				)}

				{entries.map(([ws, wsProjects]) => {
					const isOpen = !isCollapsed(ws);
					const count = wsProjects.length;
					const fs = wsProjects[0]?.file_system ?? 'Windows';
					const wsState = stateFor(ws);
					const isStale = wsState?.status === 'cached';

					return (
						<div key={ws}>
							{/* the header is the handle, open or collapsed, and the only
							    thing that accepts a drop */}
							<div
								className={`${col} relative px-3 py-2 cursor-pointer hover:bg-bg-hover/50 select-none ${dragging === ws ? 'opacity-40' : ''}`}
								data-ws-header={ws}
								onPointerDown={e => headerPointerDown(e, ws)}
								onPointerMove={headerPointerMove}
								onPointerUp={e => endDrag(e, true)}
								onPointerCancel={e => endDrag(e, false)}
								onClick={() => {
									if (swallowClick.current) {
										swallowClick.current = false;
										return;
									}
									toggle(ws);
								}}
								onContextMenu={e => {
									e.preventDefault();
									onWorkspaceContextMenu?.(ws, e.clientX, e.clientY);
								}}
								title={ws}
							>
								{drop?.ws === ws && (
									<div
										className={`absolute left-4 right-4 h-0.5 bg-accent rounded-control pointer-events-none ${drop.after ? 'bottom-0' : 'top-0'}`}
									/>
								)}
								<div className='flex items-center gap-2 text-text-secondary min-w-0'>
									<span
										className={`text-13 shrink-0 ${isOpen ? 'text-accent' : 'text-text-muted'}`}
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
								<FsCell {...{ fs, className: 'font-medium' }} />
								<div className='text-right text-13 text-text-muted font-mono'>
									{count}
								</div>
							</div>

							{/* 0fr to 1fr animates height with nothing measured; the rows stay
							    mounted and clipped, and `visible` already skips them for the
							    keyboard */}
							<div
								className='grid transition-[grid-template-rows] duration-150 ease-out'
								style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
							>
								<div
									className={`overflow-hidden ml-6 border-l-2 ${RAIL[fs] ?? RAIL.Windows}`}
								>
									{wsProjects
										.filter(p => !pinnedPaths.has(p.full_path))
										.map(project => (
											<ProjectRow
												key={project.full_path}
												{...{ ...rowProps(project), stale: isStale }}
											/>
										))}
								</div>
							</div>
						</div>
					);
				})}

				{githubLane}
			</div>
		</div>
	);
};

export default ProjectTree;
