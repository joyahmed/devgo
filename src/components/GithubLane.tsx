import { compactCount, RECENT_LIMIT, relativeTime } from '../github';
import { isMac } from '../platform';
import Button from './Button';
import GithubControls from './GithubControls';
import LaneHeading from './LaneHeading';
import { card, laneBody, row, rowFlat, rowIndented, zebra } from './rowStyles';
import SearchBox from './SearchBox';

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

// the heading's one sentence, driven by the three states of the auth
// answer. the lane never shows an empty list that looks like "no repos":
// each state names its fix, and Settings says the same sentence
const headerLine = (g: GithubState): string => {
	const cache = g.payload?.cache;
	if (cache && cache.fetched_at > 0) {
		const n = cache.repos.length;
		const when = g.refreshing
			? 'refreshing…'
			: `updated ${relativeTime(cache.fetched_at)}`;
		return `${n} ${n === 1 ? 'repo' : 'repos'} · ${when}`;
	}
	if (g.status && !g.status.installed)
		return `gh not found. Install: ${isMac ? 'brew install gh' : 'winget install GitHub.cli'}`;
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

// the one moment the row has something more current to say than the
// time: a clone in flight takes the time's slot
const jobLine = (job: CloneJob): string =>
	job.status === 'failed'
		? 'clone failed'
		: job.status === 'queued'
			? 'queued'
			: `${job.phase}${job.percent !== null ? ` ${job.percent}%` : '…'}`;

// a repo row: the name grows and the meta cluster keeps its size. not
// nameCell: a repo's meta is three short things, and the fixed share cut
// long names off with empty space to their right
const RepoRow = ({
	repo,
	isCursor,
	localPath,
	job,
	login,
	i,
	gone,
	onSelect,
	onOpen,
	onContextMenu,
	onShowLocal,
	onOpenBranches
}: RepoRowProps) => (
	<div
		className={`${row} py-1.5 ${repo.archived || gone ? 'opacity-60' : ''} ${
			isCursor
				? 'bg-bg-selected text-text-primary'
				: `text-text-secondary hover:bg-bg-hover/50 ${zebra(i)}`
		}`}
		onContextMenu={e => {
			e.preventDefault();
			onSelect(repo);
			onContextMenu(repo, e.clientX, e.clientY);
		}}
		title={repo.url}
	>
		<div className={rowIndented}>
			{/* the name is the click target, as on a project row */}
			<div
				className={`flex items-center gap-1.5 flex-1 min-w-0 font-medium font-mono cursor-pointer ${
					isCursor ? 'text-text-primary' : ''
				}`}
				onClick={() => onSelect(repo)}
				onDoubleClick={() => onOpen(repo)}
			>
				<span className='truncate'>
					{/* owner/ only when it is not the user: their own repos are
					    the common case, and the prefix would be their login on
					    every row */}
					{repo.owner !== login && (
						<span className='text-text-muted'>{repo.owner}/</span>
					)}
					{repo.name}
				</span>
				{repo.private && <Lock />}
			</div>
			<div className='flex items-center justify-end gap-1.5 shrink-0'>
				{/* a repo you deleted or lost access to is a fact on screen, not
				    a silent absence in a group you curated */}
				{gone && (
					<span
						className='text-11 text-danger shrink-0'
						title='Not in your GitHub list any more. Remove it from the group, or refresh'
					>
						gone
					</span>
				)}
				{repo.archived && (
					<span className='text-11 text-text-muted shrink-0'>archived</span>
				)}
				{/* a word, not a pill: most of the newest rows are clones, and a
				    chip on each turned the meta into a column of chips */}
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
						<span className='text-11 text-accent hover:underline'>local</span>
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
	</div>
);

// the user's github repositories as a lane beside the filesystem lanes:
// a card with the same sticky heading, the heading also the collapse
// handle and, on a first run, the door to the first fetch. default
// content is the newest RECENT_LIMIT; a query reaches all of them
// through the palette's matcher
const GithubLane = ({
	github,
	cursor,
	onSelect,
	onOpen,
	onContextMenu,
	onShowLocal,
	onOpenBranches,
	jobs,
	onGroupContextMenu,
	onAddMenu,
	searchInHeading = true,
	searchRef,
	onArrow,
	onEnter
}: GithubLaneProps) => {
	const {
		query,
		setQuery,
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
	const rowFor = (repo: GithubRepo, i: number, gone: boolean) => (
		<RepoRow
			key={repo.full_name}
			{...{
				repo,
				isCursor: cursor === repo.full_name,
				localPath: local[repo.full_name],
				job: jobs?.get(repo.full_name),
				login,
				i,
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
			<LaneHeading
				{...{
					label: 'GitHub',
					tone: 'text-text-primary',
					line: headerLine(github),
					open: isOpen,
					onToggle: toggleOpen
				}}
			>
				{login && (
					<span
						className='text-11 text-text-muted font-mono shrink-0'
						title='Logged in as'
					>
						{login}
					</span>
				)}
				{/* the lane's own box, when the command row has no column for
				    it: it searches the cache instantly and, with the switch on,
				    all of github after the keystrokes settle */}
				{searchInHeading && total > 0 && (
					<div
						className='w-[min(320px,40%)]'
						onClick={e => e.stopPropagation()}
					>
						<SearchBox
							{...{
								ref: searchRef,
								value: query,
								onChange: setQuery,
								onArrow,
								onEnter,
								placeholder: 'Search GitHub repos…',
								lane: 'github' as const,
								className: '-my-1.5 [&_input]:py-1 [&_input]:text-13'
							}}
						/>
					</div>
				)}
				{searchInHeading && onAddMenu && (
					<GithubControls {...{ github, onAddMenu }} />
				)}
			</LaneHeading>

			{/* the 0fr to 1fr trick the workspace groups use, so the lane opens
			    and closes the way they do; the body scrolls inside it */}
			<div
				className='grid transition-[grid-template-rows] duration-150 ease-out min-[1400px]:flex-1 min-[1400px]:min-h-0'
				style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
			>
				<div className='overflow-hidden min-h-0 min-[1400px]:h-full flex flex-col'>
					<div className={`${laneBody} min-[1400px]:h-full`}>
						{github.lastError && (
							<div className='px-4 py-2 text-13 text-danger'>
								{github.lastError}
							</div>
						)}
						{isOpen && total === 0 && !github.refreshing && !github.lastError && (
							<div className='px-4 py-3 text-13 text-text-muted'>
								{emptyLine(status)}
							</div>
						)}
						{total > 0 && visible.length === 0 && !searching && (
							<div className='px-4 py-3 text-13 text-text-muted'>
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
										<div className={`${rowFlat} py-2 text-11 text-text-muted`}>
											{part.label}
										</div>
									)}
									{part.rows.map((repo, i) => rowFor(repo, i, false))}
								</div>
							))}
						{shown?.map((section, i) => {
							const name = section.group;
							const isFolded = name !== null && folded.has(name);
							const heading = name !== null || (sections?.length ?? 0) > 1;
							// a short rule in the accent over every group but the first
							// (joy: "github groups should also have separator")
							return (
								<div key={name ?? '\u0000tail'} className={i ? 'mt-2 pt-1' : ''}>
									{i > 0 && (
										<div
											aria-hidden='true'
											className='h-px ml-4 mb-1 w-[38%] bg-linear-to-r from-accent/70 to-transparent'
										/>
									)}
									{heading && (
										<div
											className={`${row} py-2 ${
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
											<div className={rowFlat}>
												<div className='flex items-center gap-2 min-w-0'>
													{name !== null && (
														<span
															className={`text-13 shrink-0 ${isFolded ? 'text-text-muted' : 'text-accent'}`}
														>
															{isFolded ? '▶' : '▼'}
														</span>
													)}
													{/* a group heading is the same kind of thing as a
													    workspace header: one step under the rows */}
													<span
														className={`truncate text-13 font-semibold ${name === null ? 'text-text-muted' : 'text-text-primary'}`}
													>
														{name ?? 'Not in a group'}
													</span>
												</div>
												<span className='flex-1' />
												<div className='text-11 text-text-muted font-mono shrink-0 w-8 text-right'>
													{section.total}
												</div>
											</div>
										</div>
									)}
									{!isFolded &&
										section.rows.map((repo, j) =>
											rowFor(repo, j, section.gone.has(repo.full_name))
										)}
									{name !== null && !isFolded && section.rows.length === 0 && (
										<div className='pl-10 pr-4 py-2 text-13 text-text-muted'>
											Empty. Right-click a repo and choose Add to group.
										</div>
									)}
								</div>
							);
						})}
						{/* say what the default view is, so twenty rows out of a few
						    hundred never reads as "where are the rest" */}
						{isOpen && showRecents && tail && tail.total > RECENT_LIMIT && (
							<div className='px-4 py-2 text-11 text-text-muted'>
								{RECENT_LIMIT} most recently updated of {tail.total}
								{sections && sections.length > 1 ? ' not in a group' : ''}. Type
								to search all of them.
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
};

export default GithubLane;
