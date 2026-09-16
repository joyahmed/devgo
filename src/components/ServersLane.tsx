import Button from './Button';
import { card, col } from './rowStyles';
import SearchBox from './SearchBox';

// where the row reaches: user@host, or the host alone
const whoAt = (s: Server) => (s.user ? `${s.user}@${s.host}` : s.host);

const DEFAULT_ROOTS = ['~', '~/projects', '/var/www', '/srv'];

// the words in the meta cell: the port when it is not 22, tunnel when the
// config forwards one, tmux when enter lands in a session
const metaWords = (s: Server) => [
	{
		key: 'port',
		show: s.port !== null && s.port !== 22,
		text: `:${s.port}`,
		title: 'Port'
	},
	{
		key: 'tunnel',
		show: s.tunnel,
		text: 'tunnel',
		title: 'The config forwards a port through this host'
	},
	{
		key: 'tmux',
		show: s.tmux,
		text: 'tmux',
		title: `tmux session ${s.session ?? 'devgo'} on the server`
	}
];

const ago = (secs: number) => {
	const d = Math.max(0, Math.floor(Date.now() / 1000) - secs);
	if (d < 60) return 'just now';
	if (d < 3600) return `${Math.floor(d / 60)} min ago`;
	if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
	return `${Math.floor(d / 86400)} d ago`;
};

// the dot: never asked, up, or down with the reason in the tooltip.
// drawn, not a glyph
const dotFor = (l?: ServerListing) =>
	!l
		? {
				className: 'border border-text-muted',
				title: 'Not checked yet. Expand or ↻ to list its folders'
			}
		: l.up
			? {
					className: 'bg-emerald-400',
					title: `Reached ${ago(l.listed_at)} · ${l.folders.length} folders`
				}
			: {
					className: 'bg-danger',
					title: `Unreachable ${ago(l.listed_at)}${l.error ? ` — ${l.error}` : ''}`
				};

// folders by their root, first-seen order, which is the roots' order
// since ls -d prints the globs as given
const groupByRoot = (folders: RemoteFolder[]) => {
	const out = new Map<string, RemoteFolder[]>();
	for (const f of folders) {
		const key = f.root || '/';
		out.set(key, [...(out.get(key) ?? []), f]);
	}
	return [...out.entries()];
};

// a server in the same four columns a project uses: where it reaches in
// the workspace column, the name where the location goes, SSH as its
// file system, and the meta cell on the right. the expander before the
// name is the ask: the first open lists the box's folders over one ssh;
// after that the cache paints and ↻ re-asks
const ServerRow = ({
	server,
	isCursor,
	listing,
	busy,
	expanded,
	onToggle,
	onRefresh,
	onSelect,
	onOpen,
	onContextMenu
}: ServerRowProps) => {
	const dot = dotFor(listing);
	return (
		<div
			className={`${col} px-3 py-1.5 select-none transition-colors ${
				isCursor
					? 'bg-bg-selected text-text-primary'
					: 'text-text-secondary hover:bg-bg-hover/50'
			}`}
			onContextMenu={e => {
				e.preventDefault();
				onSelect(server);
				onContextMenu(server, e.clientX, e.clientY);
			}}
			title={server.alias ? `ssh ${server.alias}` : `ssh ${whoAt(server)}`}
		>
			<div className='flex items-center gap-2 min-w-0'>
				<Button
					variant='ghost'
					className={`text-11 leading-none w-4 p-0 hover:bg-transparent shrink-0 ${
						expanded ? 'text-accent' : 'text-text-muted'
					}`}
					title={expanded ? 'Hide folders' : 'Show folders on the server'}
					onClick={e => {
						e.stopPropagation();
						onToggle(server);
					}}
				>
					{busy ? '…' : expanded ? '▼' : '▶'}
				</Button>
				<span
					className={`size-[7px] rounded-full shrink-0 ${dot.className}`}
					title={dot.title}
					aria-hidden='true'
				/>
				<span className='truncate font-mono text-13 text-text-muted'>
					{whoAt(server)}
				</span>
			</div>
			{/* the name is the click target, as on a project row */}
			<div
				className={`flex items-center gap-2 min-w-0 font-medium font-mono cursor-pointer ${
					isCursor ? 'text-text-primary' : ''
				}`}
				onClick={() => onSelect(server)}
				onDoubleClick={() => onOpen(server)}
			>
				<span className='truncate'>{server.name}</span>
				{server.alias && server.alias !== server.name && (
					<span className='text-11 text-text-muted shrink-0'>
						{server.alias}
					</span>
				)}
			</div>
			<div className='text-emerald-300'>SSH</div>
			<div className='flex items-center justify-end gap-1.5 min-w-0'>
				{metaWords(server)
					.filter(w => w.show)
					.map(w => (
						<span
							key={w.key}
							className='font-mono text-11 text-text-muted shrink-0'
							title={w.title}
						>
							{w.text}
						</span>
					))}
				<Button
					variant='ghost'
					className='text-13 leading-none p-0.5 hover:bg-transparent hover:text-accent disabled:cursor-wait'
					title="List the server's folders again (one ssh)"
					disabled={busy}
					onClick={e => {
						e.stopPropagation();
						onRefresh(server);
					}}
				>
					↻
				</Button>
			</div>
		</div>
	);
};

// a folder under its server: the root where the workspace goes, the name
// as the click target, one step in from the server row
const FolderRow = ({
	server,
	folder,
	isCursor,
	onSelect,
	onOpen,
	onContextMenu
}: FolderRowProps) => (
	<div
		className={`${col} px-3 py-1 ml-6 select-none transition-colors ${
			isCursor
				? 'bg-bg-selected text-text-primary'
				: 'text-text-secondary hover:bg-bg-hover/50'
		}`}
		onContextMenu={e => {
			e.preventDefault();
			onSelect(server, folder);
			onContextMenu(server, folder, e.clientX, e.clientY);
		}}
		title={folder.path}
	>
		<div className='truncate font-mono text-11 text-text-muted pl-10'>
			{folder.root}
		</div>
		<div
			className={`font-mono text-13 truncate cursor-pointer ${
				isCursor ? 'text-text-primary' : ''
			}`}
			onClick={() => onSelect(server, folder)}
			onDoubleClick={() => onOpen(server, folder)}
		>
			{folder.name}
		</div>
		<div />
		<div />
	</div>
);

// the machines you ssh into, as one more card in the table: a header that
// collapses like a workspace's, one row per server, and under an expanded
// server its folders grouped by root. nothing here touches the network on
// its own; the expander and ↻ are the asks
const ServersLane = ({
	servers,
	cursor,
	onSelect,
	onOpen,
	onContextMenu,
	onAddMenu,
	folderCursor,
	onSelectFolder,
	onOpenFolder,
	onFolderContextMenu,
	onArrow,
	onEnter
}: ServersLaneProps) => {
	const {
		servers: all,
		isOpen,
		toggleOpen,
		listings,
		listing,
		expanded,
		toggleExpanded,
		listFolders,
		query,
		setQuery
	} = servers;

	// the filter: a server by name, alias, host or user; a folder by name or
	// path. a folder hit keeps its server, and a query shows the hits under
	// every server that has one
	const q = query.trim().toLowerCase();
	const matchesServer = (s: Server) =>
		!q ||
		[s.name, s.alias ?? '', s.host, s.user ?? ''].some(t =>
			t.toLowerCase().includes(q)
		);
	const folderHits = (s: Server) =>
		(listings[s.id]?.folders ?? []).filter(
			f =>
				!q ||
				f.name.toLowerCase().includes(q) ||
				f.path.toLowerCase().includes(q)
		);
	const list = all.filter(s => matchesServer(s) || folderHits(s).length > 0);
	const countLine =
		all.length === 0
			? 'none yet'
			: `${all.length} ${all.length === 1 ? 'machine' : 'machines'}`;

	// what sits under an expanded server: the reason it is down, an empty
	// note, the busy word, or the folders grouped by root
	const under = (s: Server) => {
		const l = listings[s.id];
		const folders = q ? folderHits(s) : (l?.folders ?? []);
		const roots = s.roots.length ? s.roots : DEFAULT_ROOTS;
		return (
			<div>
				{l && !l.up && l.error && (
					<div
						className='ml-6 px-3 py-1 text-11 text-danger truncate'
						title={l.error}
					>
						{l.error}
					</div>
				)}
				{l && l.up && l.folders.length === 0 && (
					<div className='ml-6 px-3 py-1 text-11 text-text-muted'>
						Nothing under {roots.join(', ')}. Edit the roots in Settings ›
						Servers.
					</div>
				)}
				{!l && listing.has(s.id) && (
					<div className='ml-6 px-3 py-1 text-11 text-text-muted'>Listing…</div>
				)}
				{groupByRoot(folders).map(([root, rows]) => (
					<div key={root}>
						{/* a root heading is the same kind of thing as a group
						    heading in the github card: one step under the rows */}
						<div
							className={`${col} px-3 py-1 ml-6 select-none`}
							title={`${rows.length} under ${root}`}
						>
							<div className='flex items-center gap-2 min-w-0 pl-6'>
								<span className='text-11 text-text-muted shrink-0'>▾</span>
								<span className='truncate font-mono text-13 font-semibold text-text-primary'>
									{root}
								</span>
							</div>
							<div />
							<div />
							<div className='text-right text-13 text-text-muted font-mono'>
								{rows.length}
							</div>
						</div>
						{rows.map(f => (
							<FolderRow
								key={`${s.id}:${f.path}`}
								{...{
									server: s,
									folder: f,
									isCursor: folderCursor === `${s.id}:${f.path}`,
									onSelect: onSelectFolder,
									onOpen: onOpenFolder,
									onContextMenu: onFolderContextMenu
								}}
							/>
						))}
					</div>
				))}
			</div>
		);
	};

	return (
		<div className={`${card} border-t-emerald-400/50 border-l-emerald-400/50`}>
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
						Servers
					</span>
				</div>
				<div className='text-text-muted truncate'>{countLine}</div>
				{/* the card's own box: a server, or a folder on one. it folds into
				    the heading the way the github box did before its own line */}
				<div onClick={e => e.stopPropagation()}>
					{all.length > 0 && (
						<SearchBox
							{...{
								value: query,
								onChange: setQuery,
								onArrow,
								onEnter,
								placeholder: 'Search servers & folders…',
								lane: 'servers' as const,
								className: '-my-1 [&_input]:py-1 [&_input]:text-13'
							}}
						/>
					)}
				</div>
				<div className='flex justify-end'>
					{/* the door to a row: add one by hand, or import the config */}
					<Button
						variant='ghost'
						className='text-11 px-1.5 py-0.5'
						title='Add a server, or import ~/.ssh/config'
						onClick={e => {
							e.stopPropagation();
							const r = e.currentTarget.getBoundingClientRect();
							onAddMenu(r.left, r.bottom + 4);
						}}
					>
						+ Add
					</Button>
				</div>
			</div>

			<div
				className='grid transition-[grid-template-rows] duration-150 ease-out'
				style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
			>
				<div className='overflow-hidden ml-6'>
					{all.length === 0 && (
						<div className='px-3 py-2 text-15 text-text-muted'>
							No servers yet. Add one, or import{' '}
							<span className='font-mono'>~/.ssh/config</span>.
						</div>
					)}
					{q && list.length === 0 && (
						<div className='px-3 py-2 text-15 text-text-muted'>
							Nothing matches <span className='font-mono'>{query.trim()}</span>.
						</div>
					)}
					{list.map(server => {
						// with a query every server that has a hit reads as expanded,
						// so the hits are on screen
						const open =
							expanded.has(server.id) ||
							(q.length > 0 && folderHits(server).length > 0);
						return (
							<div key={server.id}>
								<ServerRow
									{...{
										server,
										isCursor: cursor === server.id,
										listing: listings[server.id],
										busy: listing.has(server.id),
										expanded: open,
										onToggle: (s: Server) => toggleExpanded(s.id),
										onRefresh: (s: Server) => listFolders(s.id).catch(() => {}),
										onSelect,
										onOpen,
										onContextMenu
									}}
								/>
								{open && under(server)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
};

export default ServersLane;
