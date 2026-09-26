import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { lastSegment } from '../paths';
import { isTypingTarget, matches, shortcutFor } from '../shortcuts';
import Button from './Button';
import GithubLane from './GithubLane';
import LaneHeading from './LaneHeading';
import ServersLane from './ServersLane';
import {
	card,
	fsEdge,
	fsTone,
	laneBody,
	laneGrid,
	nameCell,
	row,
	rowFlat,
	rowIndented,
	zebra
} from './rowStyles';

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

const NETWORK_WARNING =
	'On a network share — file access and dev tooling are slow here. Consider a local drive or a WSL-native path.';

const FsCell = ({ fs, className = '' }: FsCellProps) => (
	<div
		className={`${fsTone(fs)} ${className}`.trim()}
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
	const cached = state.status === 'cached';
	// the cache first paint has no reason: the scan is still out, the
	// workspace is not unavailable
	const label = state.reason
		? REASON_LABEL[state.reason]
		: cached
			? 'scanning'
			: 'unavailable';
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
					className='size-[7px] rounded-full border border-text-muted shrink-0'
					title='Dependencies do not appear to be installed'
				/>
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
			{/* a drawn dot, not a glyph: a character sits on the baseline and
			    lands a pixel off the text's centre; a box is centred by flex */}
			{info.dirty && (
				<span
					className='size-[7px] rounded-full bg-amber-400 shrink-0'
					title='Uncommitted changes'
				/>
			)}
			<span
				className={`truncate font-mono text-13 text-text-muted ${
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
	live,
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
		{/* the session is still there, after devgo, the terminal, a reboot
		    of the distro; enter reattaches, and the chip is what says so */}
		{live && (
			<span
				className='text-11 font-semibold text-accent shrink-0 inline-flex items-center gap-1'
				title={`${project.file_system === 'Windows' ? 'psmux' : 'tmux'} session is running; a terminal launch reattaches`}
			>
				<span
					className='size-[7px] rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]'
					aria-hidden='true'
				/>
				live
			</span>
		)}
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
				className={`text-15 leading-none p-0.5 hover:scale-110 hover:bg-transparent transition-opacity ${
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
/// under its workspace header; a pinned row names its workspace, a row
/// under a heading inherits it. no workspace and no file-system cell on
/// a row under its heading: the heading states both, once
const ProjectRow = ({
	project,
	selected,
	i = 0,
	pinned,
	stale,
	quiet,
	showHints,
	launching,
	rank,
	git,
	tech,
	live,
	onSelect,
	onDoubleClick,
	onTogglePin,
	onOpenBranches,
	onContextMenu
}: ProjectRowProps) => (
	<div
		className={`${row} group py-2.5 ${stale ? 'opacity-60' : ''} ${
			launching ? 'animate-launch' : ''
		} ${
			selected
				? quiet
					? 'bg-bg-selected/40 text-text-primary'
					: 'bg-bg-selected text-text-primary shadow-[var(--color-glow)]'
				: `text-text-primary hover:bg-bg-hover/50 ${pinned ? '' : zebra(i)}`
		}`}
		// select first so the menu and the keyboard agree on the row
		onContextMenu={e => {
			e.preventDefault();
			onSelect(project);
			onContextMenu?.(project, e.clientX, e.clientY);
		}}
	>
		<div
			className={`${rowIndented} ${pinned ? 'border-l-accent/60' : 'border-l-border'}`}
		>
			{/* the name is the click target, not the row (joy: "the whole line
			    being clickable makes it a bit inconvenient"): on a wide row a
			    click meant for the empty middle, or a double-click near a chip,
			    selected or launched a project. the row keeps hover and right-click */}
			<div
				className={`${nameCell} cursor-pointer`}
				onClick={() => onSelect(project)}
				onDoubleClick={() => onDoubleClick(project)}
			>
				{project.name}
			</div>
			{/* a pinned row floats above the lanes, so unlike a row under its
			    heading it has to name its own home: a suffix, not a column */}
			{pinned && (
				<>
					<span
						className='text-text-muted text-13 truncate shrink-0'
						title={project.workspace}
					>
						{lastSegment(project.workspace)}
					</span>
					<FsCell {...{ fs: project.file_system, className: 'text-13 shrink-0' }} />
				</>
			)}
			<RowMeta
				{...{ project, showHints, rank, git, tech, live, onTogglePin, onOpenBranches }}
			/>
		</div>
	</div>
);

/// the workspace header: the handle, open or collapsed, and the only
/// thing that accepts a drop. one flex line: arrow, name, state, the
/// path, the warning when it is a share, the count
const WorkspaceHeader = ({
	ws,
	count,
	fs,
	state,
	open,
	cursor,
	dragging,
	drop,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
	onClick,
	onContextMenu
}: WorkspaceHeaderProps) => (
	<div
		className={`${row} relative py-3 cursor-pointer ${
			cursor ? 'bg-bg-selected/50' : 'hover:bg-bg-hover/50'
		} ${dragging ? 'opacity-40' : ''}`}
		data-ws-header={ws}
		{...{ onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick }}
		onContextMenu={e => {
			e.preventDefault();
			onContextMenu(e.clientX, e.clientY);
		}}
		title={ws}
	>
		{drop && (
			<div
				className={`absolute left-4 right-4 h-0.5 bg-accent rounded-control pointer-events-none ${drop === 'after' ? 'bottom-0' : 'top-0'}`}
			/>
		)}
		<div className={rowFlat}>
			<div className='flex items-center gap-2 text-text-primary min-w-0'>
				<span
					className={`text-11 shrink-0 ${open ? 'text-accent' : 'text-text-muted'}`}
				>
					{open ? '▼' : '▶'}
				</span>
				{/* one step under the rows: a workspace header is a label for
				    the rows, not a row */}
				<span className='truncate text-13 font-semibold text-text-primary'>
					{lastSegment(ws)}
				</span>
				<StatusPill {...{ state }} />
			</div>
			{/* text-primary, not muted (joy: "paths are too dimmed"): at 11px a
			    grey two steps down reads as disabled. the hierarchy against the
			    bold name comes from weight and size */}
			<div className='text-text-primary truncate min-w-0 flex-1 text-11' title={ws}>
				{ws}
			</div>
			{/* the lane heading already says which file system; only a share
			    still has something to add, its warning */}
			{fs === 'Network' && (
				<FsCell {...{ fs, className: 'font-medium shrink-0 text-11' }} />
			)}
			<div className='text-11 text-text-muted font-mono shrink-0 w-8 text-right'>
				{count}
			</div>
		</div>
	</div>
);

/// a filesystem lane: the card, its sticky heading with the counts, and
/// its workspaces scrolling under it
const WorkspaceLane = ({ label, tone, edge, entries, children }: WorkspaceLaneProps) => {
	const projects = entries.reduce((n, [, ps]) => n + ps.length, 0);
	const line = `${entries.length} ${entries.length === 1 ? 'workspace' : 'workspaces'} · ${projects} ${projects === 1 ? 'project' : 'projects'}`;
	return (
		<div className={`${card} ${edge}`}>
			<LaneHeading {...{ label, tone, line }} />
			<div className={laneBody}>{children}</div>
		</div>
	);
};

/// which lane a workspace lives in. two, not three: a share is a local
/// path with a warning, so it sits on the local side and keeps its cell
const laneOf = (fs: string) => (fs === 'WSL' ? 'WSL' : 'local');

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
	sessions,
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
	onRepoBranches,
	onRepoCursor,
	trafficByRepo,
	cloneJobs,
	onGroupContextMenu,
	servers,
	onServerOpen,
	onServerCursor,
	onServerContextMenu,
	onServersAddMenu,
	onServersHeadingContextMenu,
	onFolderOpen,
	onFolderContextMenu,
	onRootContextMenu,
	onServerSetup,
	showHints,
	launchingPath,
	localFs,
	onGithubAddMenu,
	githubSearchRef,
	githubSearchInHeading = true,
	serversSearchRef,
	serversSearchInHeading = true,
	ref
}: ProjectTreeProps) => {
	const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
	// a workspace header under the cursor: kept beside selected (still a
	// project, for launching) so a collapsed workspace is reachable by
	// arrow without inventing a fake selection
	const [wsCursor, setWsCursor] = useState<string | null>(null);
	// a repo row under the cursor: not a Project, so never selected, but
	// reachable by arrow. beside the selection, and any change of the
	// selection drops it, so the two are never lit at once
	const [repoCursor, setRepoCursor] = useState<string | null>(null);
	// and a server row, the same arrangement; a folder under an expanded
	// server by `${id}:${path}`
	const [serverCursor, setServerCursor] = useState<string | null>(null);
	const [folderCursor, setFolderCursor] = useState<string | null>(null);
	// the footer follows the server row: told on the way in and out
	const clearCursors = () => {
		setWsCursor(null);
		setRepoCursor(null);
		setServerCursor(null);
		setFolderCursor(null);
		onServerCursor?.(null);
		onRepoCursor?.(null);
	};
	useEffect(clearCursors, [selected]);
	const folderKey = (s: Server, f: RemoteFolder) => `${s.id}:${f.path}`;
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

	// the workspaces by lane, wsl then local, the order the lanes render:
	// the keyboard walks the same sequence the eye does, down the first
	// lane and then down the second
	const lanes: Record<'WSL' | 'local', [string, Project[]][]> = {
		WSL: [],
		local: []
	};
	for (const entry of entries) {
		lanes[laneOf(entry[1][0]?.file_system ?? 'Windows')].push(entry);
	}
	const laneOfWs = (ws: string) =>
		laneOf(grouped.get(ws)?.[0]?.file_system ?? 'Windows');
	const laneOrder = [...lanes.WSL, ...lanes.local];

	// move ws to sit before or after target and hand back the whole order:
	// the store can check a permutation, it cannot check a move. both live
	// in one lane, so the other lane's order is untouched even though the
	// store holds one flat list
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

	// only a header in the same lane is a target: a wsl path in the local
	// lane is a category error, refused rather than let "work"
	const dropTargetAt = (x: number, y: number, from: string) => {
		const el = document
			.elementFromPoint(x, y)
			?.closest<HTMLElement>('[data-ws-header]');
		if (!el) return null;
		const ws = el.dataset.wsHeader ?? '';
		if (ws === from || laneOfWs(ws) !== laneOfWs(from)) return null;
		const r = el.getBoundingClientRect();
		// which half of the row decides before or after, so the line is honest
		return { ws, after: y > r.top + r.height / 2 };
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
		const next = dropTargetAt(e.clientX, e.clientY, d.ws);
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
			const t = dropTargetAt(e.clientX, e.clientY, d.ws);
			if (t) moveWorkspace(d.ws, t.ws, t.after);
		}
		setDragging(null);
		setDrop(null);
	};

	// the keyboard twin of dragging the header: the workspace moves one
	// place among its lane's siblings, and the cursor follows it
	const nudge = (ws: string, dir: 1 | -1) => {
		const lane = lanes[laneOfWs(ws)];
		const i = lane.findIndex(([w]) => w === ws);
		const target = lane[i + dir];
		if (i < 0 || !target) return;
		setWsCursor(ws);
		moveWorkspace(ws, target[0], dir === 1);
	};

	// Pinned rows come first for keyboard navigation, and are then skipped in
	// the tree below so arrowing down never lands on the same project twice.
	const pinned = pinnedProjects ?? [];
	const pinnedPaths = new Set(pinned.map(p => p.full_path));

	// the navigable sequence in the order the rows render: the pinned
	// projects, then each header with its projects when open. headers are
	// rows so the keyboard can land on a collapsed workspace and open it;
	// without that a collapsed workspace is a dead end only the mouse
	// reaches. then the github rows when that lane is open, and the
	// servers last, each expanded server's folders right under it
	const rows: NavRow[] = pinned.map(project => ({ kind: 'project', project }));
	for (const [ws, wsProjects] of laneOrder) {
		rows.push({ kind: 'ws', ws });
		if (!isCollapsed(ws)) {
			for (const project of wsProjects) {
				if (!pinnedPaths.has(project.full_path)) rows.push({ kind: 'project', project });
			}
		}
	}
	for (const repo of github?.isOpen ? github.visible : []) {
		rows.push({ kind: 'repo', repo });
	}
	for (const { server, groups } of servers?.isOpen ? servers.visible : []) {
		rows.push({ kind: 'server', server });
		for (const { rows: under } of groups) {
			for (const { folder } of under) rows.push({ kind: 'folder', server, folder });
		}
	}
	const visible = rows.flatMap(r => (r.kind === 'project' ? [r.project] : []));

	const selectProject = (p: Project) => {
		clearCursors();
		onSelect(p);
	};
	const selectWs = (ws: string) => {
		clearCursors();
		setWsCursor(ws);
	};
	const selectRepo = (r: GithubRepo) => {
		clearCursors();
		setRepoCursor(r.full_name);
		onRepoCursor?.(r);
	};
	const selectServer = (s: Server) => {
		clearCursors();
		setServerCursor(s.id);
		onServerCursor?.(s);
	};
	// a folder row is still on its server: the footer stays with it
	const selectFolder = (s: Server, f: RemoteFolder) => {
		clearCursors();
		setFolderCursor(folderKey(s, f));
		onServerCursor?.(s);
	};
	const land = (r: NavRow) => {
		if (r.kind === 'project') selectProject(r.project);
		else if (r.kind === 'ws') selectWs(r.ws);
		else if (r.kind === 'repo') selectRepo(r.repo);
		else if (r.kind === 'server') selectServer(r.server);
		else selectFolder(r.server, r.folder);
	};

	// from the github box the arrows walk the github rows and nothing
	// else, the way the project box's arrows have always started at the
	// projects; from the servers box, the servers and their folders. the
	// walk is narrowed, the cursor is the same
	const LANE_KINDS: Record<SearchLane, NavRow['kind'][]> = {
		projects: ['project', 'ws', 'repo', 'server', 'folder'],
		github: ['repo'],
		servers: ['server', 'folder']
	};
	const cursorIndex = (walk: NavRow[]) =>
		wsCursor
			? walk.findIndex(r => r.kind === 'ws' && r.ws === wsCursor)
			: repoCursor
				? walk.findIndex(r => r.kind === 'repo' && r.repo.full_name === repoCursor)
				: serverCursor
					? walk.findIndex(r => r.kind === 'server' && r.server.id === serverCursor)
					: folderCursor
						? walk.findIndex(
								r => r.kind === 'folder' && folderKey(r.server, r.folder) === folderCursor
							)
						: walk.findIndex(
								r => r.kind === 'project' && r.project.full_path === selected?.full_path
							);
	const navigate = (dir: 1 | -1, lane: SearchLane = 'projects') => {
		const walk = rows.filter(r => LANE_KINDS[lane].includes(r.kind));
		const idx = cursorIndex(walk);
		// nothing under the cursor yet: the first project, or the first
		// header when every workspace is collapsed, which is exactly when
		// the keyboard needs a header to open
		const next =
			idx === -1
				? dir === 1
					? (walk.find(r => r.kind === 'project') ?? walk[0])
					: walk[walk.length - 1]
				: walk[idx + dir];
		if (next) land(next);
	};

	const openRepo = () => {
		const repo = github?.visible.find(r => r.full_name === repoCursor);
		if (!repo) return false;
		onRepoOpen?.(repo);
		return true;
	};
	// enter on a server row: a terminal on it; on a folder, a terminal there
	const openServerRow = () => {
		const r = rows.find(
			r =>
				(r.kind === 'server' && r.server.id === serverCursor) ||
				(r.kind === 'folder' && folderKey(r.server, r.folder) === folderCursor)
		);
		if (!r) return false;
		if (r.kind === 'server') onServerOpen?.(r.server);
		else if (r.kind === 'folder') onFolderOpen?.(r.server, r.folder);
		return true;
	};

	useImperativeHandle(ref, () => ({ navigate, openRepo, openServerRow }));

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
		// the workspace a directional key acts on: the header under the
		// cursor, else the selected project's
		const ws = wsCursor ?? selected?.workspace;
		// Bare navigation keys. While the search box has focus these belong to
		// it — it forwards ↑ ↓ ⏎ itself, and ← → Home End move its caret.
		const walk: Record<string, () => void> = {
			ArrowDown: () => navigate(1),
			ArrowUp: () => navigate(-1),
			Home: () => jump('top'),
			End: () => jump('bottom')
		};
		// a repo under the cursor: enter opens its page, and the workspace
		// keys are off since there is nothing to collapse. a header under
		// it: → opens a collapsed one and steps into an open one, ← closes
		// it, enter toggles it. on a project, ← steps out to its header the
		// way a file tree does
		const keys: Record<string, () => void> = repoCursor
			? { ...walk, Enter: () => openRepo() }
			: serverCursor || folderCursor
				? { ...walk, Enter: () => openServerRow() }
				: wsCursor
					? {
							...walk,
							ArrowRight: () =>
								isCollapsed(wsCursor) ? setCollapsedFor(wsCursor, false) : navigate(1),
							ArrowLeft: () => setCollapsedFor(wsCursor, true),
							Enter: () => setCollapsedFor(wsCursor, !isCollapsed(wsCursor))
						}
					: {
							...walk,
							ArrowRight: () => ws && setCollapsedFor(ws, false),
							ArrowLeft: () => {
								if (!ws) return;
								setCollapsedFor(ws, true);
								selectWs(ws);
							},
							Enter: launch
						};
		// Modifier combos are app-level and must still work while the search
		// box is focused — which is exactly where summon leaves you. A bare
		// letter is unreachable there, which is why every project action is
		// a combo.
		const combos: [ShortcutId, () => void][] = [
			['togglePin', () => selected && !wsCursor && onTogglePin?.(selected)],
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
		wsCursor,
		repoCursor,
		serverCursor,
		folderCursor,
		collapsed,
		navigate,
		onLaunch,
		onTogglePin,
		onRepoOpen,
		onServerOpen,
		onFolderOpen,
		workspaceOrder,
		onReorder
	]);

	const stateFor = (ws: string) =>
		workspaceStates?.find(s => s.workspace === ws);

	// only while there is nothing to show. loading is true for the whole of
	// a refresh too, and this line took the place of every card for a scan
	// that changes a row or two; with a list on screen the rows stay put
	// and the refresh glyph spins instead
	if (loading && projects.length === 0) {
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
				onOpenBranches: (r: GithubRepo, x: number, y: number) =>
					onRepoBranches?.(r, x, y),
				jobs: cloneJobs,
				traffic: trafficByRepo,
				onGroupContextMenu,
				onAddMenu: onGithubAddMenu,
				searchInHeading: githubSearchInHeading,
				searchRef: githubSearchRef,
				onArrow: (dir: 1 | -1) => navigate(dir, 'github'),
				onEnter: () => openRepo() || onRepoOpen?.(github.visible[0])
			}}
		/>
	) : null;

	const serversLane = servers?.hasSsh ? (
		<ServersLane
			{...{
				servers,
				cursor: serverCursor,
				onSelect: selectServer,
				onOpen: (s: Server) => onServerOpen?.(s),
				onContextMenu: (s: Server, x: number, y: number) =>
					onServerContextMenu?.(s, x, y),
				onAddMenu: (x: number, y: number) => onServersAddMenu?.(x, y),
				onHeadingContextMenu: (x: number, y: number) =>
					onServersHeadingContextMenu?.(x, y),
				searchInHeading: serversSearchInHeading,
				searchRef: serversSearchRef,
				folderCursor,
				onSelectFolder: selectFolder,
				onOpenFolder: (s: Server, f: RemoteFolder) => onFolderOpen?.(s, f),
				onFolderContextMenu: (s: Server, f: RemoteFolder, x: number, y: number) =>
					onFolderContextMenu?.(s, f, x, y),
				onRootContextMenu: (s: Server, root: string, x: number, y: number) =>
					onRootContextMenu?.(s, root, x, y),
				onSetup: (s: Server) => onServerSetup?.(s),
				onArrow: (dir: 1 | -1) => navigate(dir, 'servers'),
				onEnter: () => openServerRow()
			}}
		/>
	) : null;

	// the lane cards in the grid, in render order: wsl, the machine's own
	// disk, github, servers. every lane one equal column (joy: "i should
	// not let one column stretch to two columns space"); four fold to two
	// rows of two between 1400 and 1899, and those rows are spelled out: a
	// row holding an open lane is minmax(0,1fr), bounded, its own scroller,
	// and a row of collapsed lanes is auto, their headings. an implicit
	// auto row holding a scroller sized itself to its content, and the row
	// above collapsed to its border
	const fsLanes = (['WSL', 'local'] as const).filter(l => lanes[l].length > 0);
	const columns = fsLanes.length + (githubLane ? 1 : 0) + (serversLane ? 1 : 0);
	const secondRowOpen = Boolean(github?.isOpen) || Boolean(servers?.isOpen);
	const rowsMid =
		columns >= 4
			? `minmax(0,1fr) ${secondRowOpen ? 'minmax(0,1fr)' : 'auto'}`
			: 'minmax(0,1fr)';
	const grid = (
		children: React.ReactNode,
		empty?: React.ReactNode
	) => (
		<div className='flex-1 min-h-0 overflow-y-auto min-[1400px]:overflow-hidden flex flex-col'>
			{empty}
			<div
				className={`${laneGrid(columns)} gap-3 px-3 pb-3 min-[1400px]:flex-1 min-[1400px]:min-h-0 min-[1400px]:[grid-template-rows:var(--rows-mid)] min-[1900px]:[grid-template-rows:minmax(0,1fr)]`}
				style={{ '--rows-mid': rowsMid } as React.CSSProperties}
			>
				{children}
				{githubLane}
				{serversLane}
			</div>
		</div>
	);

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
		if (!githubLane && !serversLane) {
			return (
				<div className='flex-1 flex items-center justify-center text-15 text-text-muted'>
					No projects found. Add a workspace to begin.
				</div>
			);
		}
		// a query no project matches may still have an answer in the github
		// rows, which is half of why they are here: the empty line is a
		// line, not the whole screen, when there is a lane to show under it
		return (
			<div className='flex-1 flex flex-col min-h-0'>
				{grid(
					null,
					<div className='px-4 py-3 text-15 text-text-muted shrink-0'>
						{query.trim()
							? 'No project matches.'
							: 'No projects found. Add a workspace to begin.'}
					</div>
				)}
			</div>
		);
	}

	// two cursors can be lit at once, the project you selected and the
	// header, github row or server you then arrowed to, and enter acts on
	// the second. a cursor whose row has left the list (the box was
	// cleared) lights nothing, so it dims nothing
	const cursorLit = rows.some(
		r =>
			(r.kind === 'ws' && r.ws === wsCursor) ||
			(r.kind === 'repo' && r.repo.full_name === repoCursor) ||
			(r.kind === 'server' && r.server.id === serverCursor) ||
			(r.kind === 'folder' && folderKey(r.server, r.folder) === folderCursor)
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
		live: sessions?.has(project.full_path),
		onSelect: selectProject,
		onDoubleClick,
		onTogglePin,
		onOpenBranches,
		onContextMenu
	});

	const workspace = ([ws, wsProjects]: [string, Project[]]) => {
		const isOpen = !isCollapsed(ws);
		const fs = wsProjects[0]?.file_system ?? 'Windows';
		const wsState = stateFor(ws);
		const isStale = wsState?.status === 'cached';
		return (
			<div key={ws}>
				<WorkspaceHeader
					{...{
						ws,
						count: wsProjects.length,
						fs,
						state: wsState,
						open: isOpen,
						cursor: wsCursor === ws,
						dragging: dragging === ws,
						drop: drop?.ws === ws ? (drop.after ? 'after' : 'before') : undefined,
						onPointerDown: (e: React.PointerEvent<HTMLDivElement>) =>
							headerPointerDown(e, ws),
						onPointerMove: headerPointerMove,
						onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => endDrag(e, true),
						onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) =>
							endDrag(e, false),
						onClick: () => {
							if (swallowClick.current) {
								swallowClick.current = false;
								return;
							}
							selectWs(ws);
							setCollapsedFor(ws, isOpen);
						},
						onContextMenu: (x: number, y: number) => {
							selectWs(ws);
							onWorkspaceContextMenu?.(ws, x, y);
						}
					}}
				/>
				{/* 0fr to 1fr animates height with nothing measured; the rows stay
				    mounted and clipped, and `rows` already skips them for the
				    keyboard */}
				<div
					className='grid transition-[grid-template-rows] duration-150 ease-out'
					style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
				>
					<div className='overflow-hidden'>
						{wsProjects
							.filter(p => !pinnedPaths.has(p.full_path))
							.map((project, i) => (
								<ProjectRow
									key={project.full_path}
									{...{ ...rowProps(project), i, stale: isStale }}
								/>
							))}
					</div>
				</div>
			</div>
		);
	};

	// the lane's label is what the machine calls its own disk; the wsl
	// lane is always wsl
	const laneLabel = (lane: 'WSL' | 'local') =>
		lane === 'WSL' ? 'WSL' : localFs || 'Windows';

	return (
		<div className='flex-1 flex flex-col min-h-0'>
			{grid(
				fsLanes.map(lane => (
					<WorkspaceLane
						key={lane}
						{...{
							label: laneLabel(lane),
							tone: fsTone(laneLabel(lane)),
							edge: fsEdge(laneLabel(lane)),
							entries: lanes[lane]
						}}
					>
						{lanes[lane].map(workspace)}
					</WorkspaceLane>
				)),
				pinned.length > 0 && (
					<div className='mb-1 shrink-0'>
						<div className='px-4 py-1 text-13 font-semibold text-text-muted'>
							Pinned
						</div>
						{pinned.map(project => (
							<ProjectRow
								key={`pinned-${project.full_path}`}
								{...{ ...rowProps(project), pinned: true }}
							/>
						))}
						<div className='mx-4 my-1 border-b border-border' />
					</div>
				)
			)}
		</div>
	);
};

export default ProjectTree;
