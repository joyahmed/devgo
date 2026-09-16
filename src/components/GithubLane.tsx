import { compactCount, RECENT_LIMIT, relativeTime } from '../github';
import Button from './Button';
import { card, col } from './rowStyles';

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
// the one moment the row has something more current to say than the
// time: a clone in flight takes the time's slot
const jobLine = (job: CloneJob): string =>
	job.status === 'failed'
		? 'clone failed'
		: job.status === 'queued'
			? 'queued'
			: `${job.phase}${job.percent !== null ? ` ${job.percent}%` : '…'}`;

const RepoRow = ({
	repo,
	isCursor,
	localPath,
	job,
	nested,
	gone,
	onSelect,
	onOpen,
	onContextMenu,
	onShowLocal,
	onOpenBranches
}: RepoRowProps) => (
	<div
		className={`${col} px-3 py-1.5 ${nested ? 'ml-6' : ''} select-none transition-colors ${
			repo.archived || gone ? 'opacity-60' : ''
		} ${
			isCursor
				? 'bg-bg-selected text-text-primary'
				: 'text-text-secondary hover:bg-bg-hover/50'
		}`}
		onContextMenu={e => {
			e.preventDefault();
			onSelect(repo);
			onContextMenu(repo, e.clientX, e.clientY);
		}}
		title={repo.url}
	>
		<div className='truncate text-text-muted'>{repo.owner}</div>
		{/* the name is the click target, as on a project row */}
		<div
			className={`flex items-center gap-1.5 min-w-0 font-medium font-mono cursor-pointer ${
				isCursor ? 'text-text-primary' : ''
			}`}
			onClick={() => onSelect(repo)}
			onDoubleClick={() => onOpen(repo)}
		>
			<span className='truncate'>{repo.name}</span>
			{repo.private && <Lock />}
		</div>
		<div className='text-text-muted'>GitHub</div>
		<div className='flex items-center justify-end gap-1.5 min-w-0'>
			{/* a repo you deleted or lost access to is a fact on screen, not a
			    silent absence in a group you curated */}
			{gone && (
				<span
					className='text-11 text-danger shrink-0'
					title='Not in your GitHub list any more. Remove it from the group, or refresh'
				>
					gone
				</span>
			)}
			{repo.archived && (
				<span className='text-11 text-text-muted shrink-0'>
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
					<span className='text-11 text-accent hover:underline'>
						local
					</span>
				</Button>
			)}
			{repo.added && !localPath && (
				<span
					className='text-11 text-text-muted shrink-0'
					title='Added by name. Not one of your repositories'
				>
					added
				</span>
			)}
			{/* the same chip a project row has: click for the repo's branches,
			    each a link, from GitHub here since there may be no clone to
			    read refs/remotes from */}
			{repo.default_branch && (
				<span
					className='truncate font-mono text-11 text-text-muted hover:text-accent cursor-pointer'
					title={`${repo.default_branch} — branches on GitHub`}
					onClick={e => {
						e.stopPropagation();
						onSelect(repo);
						const r = e.currentTarget.getBoundingClientRect();
						onOpenBranches(repo, r.left, r.bottom + 4);
					}}
				>
					{repo.default_branch}
				</span>
			)}
			{repo.stars !== null && repo.stars > 0 && (
				<span className='text-11 text-text-muted shrink-0' title='Stars'>
					★ {compactCount(repo.stars)}
				</span>
			)}
			{gone ? null : job && job.status !== 'done' ? (
				<span
					className={`text-11 shrink-0 text-right truncate max-w-[14rem] ${
						job.status === 'failed' ? 'text-danger' : 'text-accent'
					}`}
					title={job.error ?? jobLine(job)}
				>
					{jobLine(job)}
				</span>
			) : (
				<span
					className='text-11 text-text-muted shrink-0 w-16 text-right'
					title={repo.updated_at}
				>
					{relativeTime(repo.updated_at)}
				</span>
			)}
		</div>
	</div>
);

// the user's github repositories as one more group in the table: a
// header that collapses like a workspace's, rows in the same columns.
// default content is the newest RECENT_LIMIT; a query reaches all of
// them through the palette's matcher
const GithubLane = ({
	github,
	cursor,
	onSelect,
	onOpen,
	onContextMenu,
	onShowLocal,
	onOpenBranches,
	jobs,
	onGroupContextMenu
}: GithubLaneProps) => {
	const {
		query,
		payload,
		status,
		isOpen,
		toggleOpen,
		visible,
		sections,
		cacheMatches,
		liveExtras,
		searching,
		folded,
		toggleGroup,
		showRecents
	} = github;
	const login = payload?.cache.login ?? status?.login ?? null;
	const total = payload?.cache.repos.length ?? 0;
	const local = payload?.local ?? {};
	// the ungrouped tail: the footer line speaks for it
	const tail = sections?.[sections.length - 1];
	// the sections on screen: the tail only while recents is on
	const shown = sections?.filter(s => s.group !== null || showRecents);

	// the flat search view: the cache's matches, then the hits from all of
	// github. two labels while a live search is in play, so a stranger's
	// hit never reads as one of yours; with the switch off, one list and
	// no label
	const liveInPlay = liveExtras.length > 0 || searching;
	const flat = [
		{
			key: 'cache',
			label: 'Your repos & bookmarks',
			show: liveInPlay && (cacheMatches?.length ?? 0) > 0,
			rows: cacheMatches ?? []
		},
		{
			key: 'live',
			label: searching
				? 'Searching GitHub…'
				: `More from GitHub — ${liveExtras.length}`,
			show: liveInPlay,
			rows: liveExtras
		}
	];

	// one row, in the flat search list and under a heading alike
	const rowFor = (repo: GithubRepo, nested: boolean, gone: boolean) => (
		<RepoRow
			key={repo.full_name}
			{...{
				repo,
				isCursor: cursor === repo.full_name,
				localPath: local[repo.full_name],
				job: jobs?.get(repo.full_name),
				nested,
				gone,
				onSelect,
				onOpen,
				onContextMenu,
				onShowLocal,
				onOpenBranches
			}}
		/>
	);

	return (
		// the accent on the edges: github rows have no file system hue
		<div className={`${card} border-t-accent/50 border-l-accent/50`}>
			{/* the header is the collapse handle and, on a first run, the door
			    to the first fetch: a click, which is what explicit ask means */}
			<div
				className={`${col} px-3 py-2 cursor-pointer hover:bg-bg-hover/50 select-none`}
				onClick={toggleOpen}
				title={isOpen ? 'Collapse' : 'Expand'}
			>
				<div className='flex items-center gap-2 text-text-secondary min-w-0'>
					<span
						className={`text-13 shrink-0 ${isOpen ? 'text-accent' : 'text-text-muted'}`}
					>
						{isOpen ? '▼' : '▶'}
					</span>
					<span className='truncate font-semibold text-text-primary'>
						GitHub
					</span>
					{login && (
						<span
							className='font-mono text-13 text-text-muted truncate'
							title='Logged in as'
						>
							{login}
						</span>
					)}
				</div>
				<div className='text-text-muted truncate'>{headerLine(github)}</div>
				{/* the controls left this row for the search line: a heading is
				    a line of text */}
				<div />
				<div className='text-right text-13 text-text-muted font-mono'>
					{total > 0 ? total : ''}
				</div>
			</div>

			<div
				className='grid transition-[grid-template-rows] duration-150 ease-out'
				style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
			>
				<div className='overflow-hidden ml-6'>
					{github.lastError && (
						<div className='px-3 py-2 text-13 text-danger'>
							{github.lastError}
						</div>
					)}
					{isOpen && total === 0 && !github.refreshing && !github.lastError && (
						<div className='px-3 py-2 text-15 text-text-muted'>
							{emptyLine(status)}
						</div>
					)}
					{total > 0 && visible.length === 0 && !searching && (
						<div className='px-3 py-2 text-15 text-text-muted'>
							No repository matches{' '}
							<span className='font-mono'>{query.trim()}</span>.
						</div>
					)}
					{/* searching: one flat list of matches, groups aside. otherwise
					    the groups in the user's order, each a heading that folds
					    like a workspace's, then the ungrouped tail */}
					{!sections &&
						flat.map(part => (
							<div key={part.key}>
								{part.show && (
									<div className='px-3 py-1.5 text-11 text-text-muted'>
										{part.label}
									</div>
								)}
								{part.rows.map(repo => rowFor(repo, false, false))}
							</div>
						))}
					{shown?.map(section => {
						const name = section.group;
						const isFolded = name !== null && folded.has(name);
						const heading = name !== null || (sections?.length ?? 0) > 1;
						return (
							<div key={name ?? '\u0000tail'}>
								{heading && (
									<div
										className={`${col} px-3 py-1.5 select-none ${
											name !== null ? 'cursor-pointer hover:bg-bg-hover/50' : ''
										}`}
										onClick={() => name !== null && toggleGroup(name)}
										onContextMenu={e => {
											if (name === null) return;
											e.preventDefault();
											onGroupContextMenu?.(name, e.clientX, e.clientY);
										}}
										title={name ?? 'Repositories in no group'}
									>
										<div className='flex items-center gap-2 min-w-0'>
											{name !== null && (
												<span
													className={`text-13 shrink-0 ${isFolded ? 'text-text-muted' : 'text-accent'}`}
												>
													{isFolded ? '▶' : '▼'}
												</span>
											)}
											<span
												className={`truncate font-semibold ${name === null ? 'text-text-muted' : 'text-text-primary'}`}
											>
												{name ?? 'Not in a group'}
											</span>
										</div>
										<div />
										<div />
										<div className='text-right text-13 text-text-muted font-mono'>
											{section.total}
										</div>
									</div>
								)}
								{!isFolded &&
									section.rows.map(repo =>
										rowFor(repo, heading, section.gone.has(repo.full_name))
									)}
								{name !== null && !isFolded && section.rows.length === 0 && (
									<div className='ml-6 px-3 py-2 text-13 text-text-muted'>
										Empty. Right-click a repo and choose Add to group.
									</div>
								)}
							</div>
						);
					})}
					{/* say what the default view is, so twenty rows out of a few
					    hundred never reads as "where are the rest" */}
					{isOpen && showRecents && tail && tail.total > RECENT_LIMIT && (
						<div className='px-3 py-1.5 text-11 text-text-muted'>
							{RECENT_LIMIT} most recently updated of {tail.total}
							{sections && sections.length > 1 ? ' not in a group' : ''}. Type
							to search all of them.
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default GithubLane;
