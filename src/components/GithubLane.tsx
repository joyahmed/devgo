import { RECENT_LIMIT, relativeTime } from '../github';
import Button from './Button';
import { col } from './rowStyles';

const Lock = () => (
	<svg
		width='11'
		height='11'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2.5'
		strokeLinecap='round'
		strokeLinejoin='round'
		className='shrink-0 text-text-muted'
		aria-label='private'
	>
		<rect x='3' y='11' width='18' height='11' rx='2' />
		<path d='M7 11V7a5 5 0 0 1 10 0v4' />
	</svg>
);

const Refresh = ({ spinning }: { spinning: boolean }) => (
	<svg
		width='13'
		height='13'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
		className={spinning ? 'animate-spin' : ''}
	>
		<path d='M21 12a9 9 0 1 1-2.64-6.36' />
		<polyline points='21 3 21 9 15 9' />
	</svg>
);

// the header's one sentence, driven by the three states of the auth
// answer. the lane never shows an empty list that looks like "no repos":
// each state names its fix, and Settings says the same sentence
const headerLine = (g: GithubState): string => {
	const cache = g.payload?.cache;
	if (cache && cache.fetched_at > 0) {
		return g.refreshing
			? 'refreshing…'
			: `updated ${relativeTime(cache.fetched_at)}`;
	}
	if (g.status && !g.status.installed)
		return 'gh not found. Install: winget install GitHub.cli';
	if (g.status && !g.status.login) return 'not logged in. Run: gh auth login';
	if (g.refreshing) return 'fetching your repos…';
	return 'not loaded. Open to fetch your repos with gh';
};

const emptyLine = (status: GhStatus | null): string =>
	status?.login
		? 'Nothing fetched yet. Press ↻ to list your repositories.'
		: status && !status.installed
			? 'Install the GitHub CLI, log in with gh auth login, then refresh.'
			: 'Log in with gh auth login, then refresh.';

// a repo in the same four columns a project uses: owner where the
// workspace goes, name where the location goes, GitHub as its file
// system, and the meta cell on the right
const RepoRow = ({
	repo,
	isCursor,
	localPath,
	onSelect,
	onOpen,
	onContextMenu,
	onShowLocal
}: RepoRowProps) => (
	<div
		className={`${col} px-3 py-1.5 ml-6 border-l cursor-pointer select-none transition-colors ${
			repo.archived ? 'opacity-60' : ''
		} ${
			isCursor
				? 'bg-bg-selected text-text-primary border-l-accent'
				: 'text-text-secondary hover:bg-bg-hover/50 border-l-border'
		}`}
		onClick={() => onSelect(repo)}
		onDoubleClick={() => onOpen(repo)}
		onContextMenu={e => {
			e.preventDefault();
			onSelect(repo);
			onContextMenu(repo, e.clientX, e.clientY);
		}}
		title={repo.url}
	>
		<div className='truncate text-text-muted'>{repo.owner}</div>
		<div
			className={`flex items-center gap-1.5 min-w-0 font-medium font-mono ${
				isCursor ? 'text-text-primary' : ''
			}`}
		>
			<span className='truncate'>{repo.name}</span>
			{repo.private && <Lock />}
		</div>
		<div className='text-text-muted'>GitHub</div>
		<div className='flex items-center justify-end gap-1.5 min-w-0'>
			{repo.archived && (
				<span className='text-[9px] uppercase tracking-wider text-text-muted shrink-0'>
					archived
				</span>
			)}
			{/* a word, not a pill: most of the newest rows are clones, and a
			    chip on each turned the meta cell into a column of chips */}
			{localPath && (
				<Button
					variant='ghost'
					className='p-0 hover:bg-transparent'
					title={`Cloned at ${localPath}. Click to show it`}
					onClick={e => {
						e.stopPropagation();
						onShowLocal(localPath);
					}}
				>
					<span className='text-[9px] uppercase tracking-wider text-accent hover:underline'>
						local
					</span>
				</Button>
			)}
			{repo.default_branch && (
				<span
					className='truncate font-mono text-[11px] text-text-muted'
					title='Default branch'
				>
					{repo.default_branch}
				</span>
			)}
			<span
				className='text-[11px] text-text-muted shrink-0 w-16 text-right'
				title={repo.updated_at}
			>
				{relativeTime(repo.updated_at)}
			</span>
		</div>
	</div>
);

// the user's github repositories as one more group in the table: a
// header that collapses like a workspace's, rows in the same columns.
// default content is the newest RECENT_LIMIT; a query reaches all of
// them through the palette's matcher
const GithubLane = ({
	github,
	query,
	cursor,
	onSelect,
	onOpen,
	onContextMenu,
	onShowLocal
}: GithubLaneProps) => {
	const { payload, status, isOpen, toggleOpen, visible } = github;
	const login = payload?.cache.login ?? status?.login ?? null;
	const total = payload?.cache.repos.length ?? 0;
	const local = payload?.local ?? {};
	const canRefresh = Boolean(status?.login);

	return (
		<div>
			{/* the header is the collapse handle and, on a first run, the door
			    to the first fetch: a click, which is what explicit ask means.
			    refresh lives here and not in the title bar: that button is the
			    disk scan, and one button for both would make every F5 cost
			    six seconds of gh */}
			<div
				className={`${col} px-3 py-2 cursor-pointer hover:bg-bg-hover/50 select-none`}
				onClick={toggleOpen}
				title={isOpen ? 'Collapse' : 'Expand'}
			>
				<div className='flex items-center gap-2 text-text-secondary min-w-0'>
					<span
						className={`text-xs shrink-0 ${isOpen ? 'text-accent' : 'text-text-muted'}`}
					>
						{isOpen ? '▼' : '▶'}
					</span>
					<span className='truncate font-semibold text-text-primary'>
						GitHub
					</span>
					{login && (
						<span
							className='font-mono text-xs text-text-muted truncate'
							title='Logged in as'
						>
							{login}
						</span>
					)}
				</div>
				<div className='text-text-muted truncate'>{headerLine(github)}</div>
				<div>
					{canRefresh && (
						<Button
							variant='ghost'
							className='w-6 h-6 -my-1'
							title='Refresh from GitHub (runs gh)'
							disabled={github.refreshing}
							onClick={e => {
								e.stopPropagation();
								github.refresh();
							}}
						>
							<Refresh spinning={github.refreshing} />
						</Button>
					)}
				</div>
				<div className='text-right text-text-muted font-mono'>
					{total > 0 ? total : ''}
				</div>
			</div>

			<div
				className='grid transition-[grid-template-rows] duration-150 ease-out'
				style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
			>
				<div className='overflow-hidden'>
					{github.lastError && (
						<div className='ml-6 px-3 py-2 text-xs text-danger'>
							{github.lastError}
						</div>
					)}
					{isOpen && total === 0 && !github.refreshing && !github.lastError && (
						<div className='ml-6 px-3 py-2 text-sm text-text-muted'>
							{emptyLine(status)}
						</div>
					)}
					{total > 0 && visible.length === 0 && (
						<div className='ml-6 px-3 py-2 text-sm text-text-muted'>
							No repository matches{' '}
							<span className='font-mono'>{query.trim()}</span>.
						</div>
					)}
					{visible.map(repo => (
						<RepoRow
							key={repo.full_name}
							{...{
								repo,
								isCursor: cursor === repo.full_name,
								localPath: local[repo.full_name],
								onSelect,
								onOpen,
								onContextMenu,
								onShowLocal
							}}
						/>
					))}
					{/* say what the default view is, so twenty rows out of a few
					    hundred never reads as "where are the rest" */}
					{isOpen && !query.trim() && total > RECENT_LIMIT && (
						<div className='ml-6 px-3 py-1.5 text-[10px] text-text-muted'>
							{RECENT_LIMIT} most recently updated of {total}. Type to search
							all of them.
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default GithubLane;
