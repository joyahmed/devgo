import Button from './Button';
import LaneHeading from './LaneHeading';
import {
	card,
	laneBody,
	row,
	rowFlat,
	searchBoxHeading,
	searchBoxHeadingSlot,
	zebra
} from './rowStyles';
import SearchBox from './SearchBox';
import { isEtc } from '../etcCuration';
import { appStatus } from '../serverApps';

// where the row reaches: user@host, or the host alone. printed only
// when the details switch is on
const whoAt = (s: Server) => (s.user ? `${s.user}@${s.host}` : s.host);

// the tooltip: the ssh line by alias, or by host when the row may say
// it; otherwise the name is all the row gives away
const rowTitle = (s: Server, details: boolean) =>
	s.alias
		? `ssh ${s.alias}`
		: details
			? `ssh ${whoAt(s)}`
			: `Open a terminal on ${s.name}`;

const DEFAULT_ROOTS = ['~', '~/projects', '/var/www', '/srv'];

// the words after the host: the port when it is not 22 and the details
// switch is on, tunnel when the config forwards one, tmux when enter
// lands in a session
const metaWords = (s: Server, details: boolean) => [
	{
		key: 'port',
		show: details && s.port !== null && s.port !== 22,
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

// the box in one line under the dot, when the inventory knows it
const hostLine = (l: ServerListing) => {
	const h = l.inventory?.host;
	if (!h) return '';
	const disk = h.disk ? ` · ${h.disk.free_gb} GB free` : '';
	return `\n${h.pm2_online}/${h.pm2_total} pm2 · ${h.nginx_sites} sites · load ${h.load[0] ?? '?'}${disk}`;
};

// what the inventory knows about a folder that is an app: the processes
// with their restarts, the site, the deployed commit. a container has no
// pm2 name, so its docker name stands in
const appTitle = (app: ServerApp, path: string) =>
	[
		...app.processes.map(
			p =>
				`${p.pm2 ?? p.docker ?? '?'} ${p.status ?? ''}${p.restarts ? ` · ${p.restarts} restarts` : ''}`
		),
		app.site ? `site ${app.site.file}${app.site.ssl ? ' · https' : ''}` : null,
		app.git?.head
			? `${app.git.branch ?? ''} @ ${app.git.head} ${app.git.subject ?? ''}`.trim()
			: null,
		path
	]
		.filter(Boolean)
		.join('\n');

// the app dot: emerald when every process is online, amber when one is
// not, hollow when nothing runs
const APP_DOT: Record<ReturnType<typeof appStatus>, string> = {
	online: 'bg-emerald-400',
	trouble: 'bg-amber-400',
	none: 'border border-text-muted'
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
					title: `Reached ${ago(l.listed_at)} · ${l.folders.length} folders${hostLine(l)}`
				}
			: {
					className: 'bg-danger',
					title: `Unreachable ${ago(l.listed_at)}${l.error ? ` — ${l.error}` : ''}`
				};

// the folder rows' indent: under the server's name, one step in per level
const folderPad = (depth: number) => 64 + depth * 16;

// one row per server: expander, dot, the name as the click target, and
// its words right-anchored, user@host among them only when the details
// switch is on. the expander before the name is the ask: the first open
// lists the box's folders over one ssh; after that the cache paints and
// ↻ re-asks
const ServerRow = ({
	server,
	isCursor,
	i,
	listing,
	busy,
	expanded,
	showDetails,
	onToggle,
	onRefresh,
	onSelect,
	onOpen,
	onContextMenu
}: ServerRowProps) => {
	const dot = dotFor(listing);
	return (
		<div
			className={`${row} py-2.5 ${
				isCursor
					? 'bg-bg-selected text-text-primary shadow-[var(--color-glow)]'
					: `text-text-primary hover:bg-bg-hover/50 ${zebra(i)}`
			}`}
			onContextMenu={e => {
				e.preventDefault();
				onSelect(server);
				onContextMenu(server, e.clientX, e.clientY);
			}}
			title={rowTitle(server, showDetails)}
		>
			{/* one step LEFT of the root headings (pl-10), which are themselves one
			    step left of their rows (folderPad 64): 16 -> 40 -> 64, an even 24px
			    ladder. not rowIndented - that is pl-10, which put the server level
			    with its own children, and rowInner's gap-4 then pushed its name
			    right of theirs so the tree read inside-out. gap-2 matches the
			    folder rows so every chevron in the lane shares a column. */}
			<div className='w-full flex items-center gap-2 text-15 pl-4 pr-4 border-l border-l-border'>
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
				{/* the name is the click target, as on a project row */}
				<div
					className='flex items-center gap-2 flex-1 min-w-0 font-medium font-mono cursor-pointer'
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
				<div className='flex items-center justify-end gap-2 min-w-0 shrink-0'>
					{showDetails && (
						<span className='font-mono text-13 text-text-muted truncate max-w-[18rem]'>
							{whoAt(server)}
						</span>
					)}
					{metaWords(server, showDetails)
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
		</div>
	);
};

// a folder under its server: the name as the click target one step in
// per level, and before it the expander that is the ask: the first open
// lists what is inside over one ssh. after the name, what the inventory
// knows: the domain, a dot for its processes, the ports
const FolderRow = ({
	server,
	row: r,
	isCursor,
	onToggle,
	onSelect,
	onOpen,
	onContextMenu
}: FolderRowProps) => {
	const { folder, depth, open, busy, inside, app } = r;
	// a bare deploy dir with no process and no site shows nothing new
	const known = !!app && (!!app.site || app.processes.length > 0);
	const ports = app?.site
		? [app.site.web_port, app.site.api_port].filter(p => p != null).join('/')
		: (app?.processes.flatMap(p => p.ports).join('/') ?? '');
	return (
		<div
			className={`${row} py-1.5 ${
				isCursor
					? 'bg-bg-selected text-text-primary shadow-[var(--color-glow)]'
					: 'text-text-primary hover:bg-bg-hover/50'
			}`}
			onContextMenu={e => {
				e.preventDefault();
				onSelect(server, folder);
				onContextMenu(server, folder, e.clientX, e.clientY);
			}}
			title={app ? appTitle(app, folder.path) : folder.path}
		>
			<div
				className='w-full flex items-center gap-2 pr-4'
				style={{ paddingLeft: folderPad(depth) }}
			>
				<Button
					variant='ghost'
					className={`text-11 leading-none w-4 p-0 hover:bg-transparent shrink-0 ${
						open ? 'text-accent' : 'text-text-muted'
					}`}
					title={open ? 'Hide what is inside' : 'Look inside (one ssh)'}
					onClick={e => {
						e.stopPropagation();
						onToggle(server, folder);
					}}
				>
					{busy ? '…' : open ? '▼' : '▶'}
				</Button>
				<span
					className='font-mono text-13 truncate flex-1 min-w-0 cursor-pointer'
					onClick={() => onSelect(server, folder)}
					onDoubleClick={() => onOpen(server, folder)}
				>
					{folder.name}
				</span>
				{open && inside === 0 && (
					<span className='text-11 text-text-muted shrink-0'>
						no folders inside
					</span>
				)}
				{known && app && (
					<>
						{app.site?.domains[0] && (
							<span
								className='font-mono text-11 text-text-muted truncate max-w-[16rem]'
								title={app.site.domains.join(', ')}
							>
								{app.site.domains[0]}
							</span>
						)}
						<span
							className={`size-[7px] rounded-full shrink-0 ${APP_DOT[appStatus(app)]}`}
							aria-hidden='true'
						/>
						{ports && (
							<span className='font-mono text-11 text-text-muted shrink-0'>
								{ports}
							</span>
						)}
					</>
				)}
				{open && inside ? (
					<span className='font-mono text-11 text-text-muted shrink-0'>
						{inside}
					</span>
				) : null}
			</div>
		</div>
	);
};

// the machines you ssh into, as a lane beside the others: a card with the
// same sticky heading, one row per server, and under an expanded server
// its folders grouped by root. nothing here touches the network on its
// own; the expander and ↻ are the asks
const ServersLane = ({
	servers,
	cursor,
	onSelect,
	onOpen,
	onContextMenu,
	onAddMenu,
	onHeadingContextMenu,
	searchInHeading = true,
	searchRef,
	folderCursor,
	onSelectFolder,
	onOpenFolder,
	onFolderContextMenu,
	onRootContextMenu,
	onSetup,
	onArrow,
	onEnter,
	enterHint
}: ServersLaneProps) => {
	const {
		servers: all,
		isOpen,
		toggleOpen,
		listings,
		listing,
		toggleExpanded,
		listFolders,
		toggleDir,
		toggleRoot,
		showAllIn,
		toggleShowAll,
		query,
		setQuery,
		visible,
		showDetails
	} = servers;

	const q = query.trim();
	const countLine =
		all.length === 0
			? 'none yet'
			: `${visible.length} ${visible.length === 1 ? 'machine' : 'machines'}`;

	// under /etc the curated view says how many it left out, and the row is
	// the request to see them; opened, it is the way back
	const showAllRow = (
		s: Server,
		parent: string,
		hidden: number | undefined,
		depth: number
	) => {
		const key = `${s.id}:${parent}`;
		const lifted = isEtc(parent) && showAllIn.has(key);
		if (!hidden && !lifted) return null;
		return (
			<div
				className='pr-4 py-1 text-11 text-text-muted cursor-pointer hover:text-accent select-none'
				style={{ paddingLeft: folderPad(depth) + 24 }}
				title='/etc is curated to developer folders; the rest is one click away'
				onClick={() => toggleShowAll(s.id, parent)}
			>
				{hidden
					? `${hidden} more system folders. Show all`
					: 'Show developer folders only'}
			</div>
		);
	};

	// what sits under an open server: the reason it is down, an empty
	// note, the busy word, or the root groups, each a heading that folds
	const under = (s: Server, groups: VisibleRoot[]) => {
		const l = listings[s.id];
		const roots = s.roots.length ? s.roots : DEFAULT_ROOTS;
		const note = 'pl-14 pr-4 py-1 text-11 truncate';
		return (
			<div>
				{l && !l.up && l.error && (
					<div className={`${note} text-danger`} title={l.error}>
						{l.error}
					</div>
				)}
				{l && l.up && l.folders.length === 0 && (
					<div className={`${note} text-text-muted`}>
						Nothing under {roots.join(', ')}. Edit the roots in Settings ›
						Servers.
					</div>
				)}
				{!l && listing.has(s.id) && (
					<div className={`${note} text-text-muted`}>Listing…</div>
				)}
				{/* the apps come from a script on the box. a box without it still
				    lists its folders; say what would give it apps, once, quietly,
				    and offer the install the app carries */}
				{l && l.up && !l.inventory && !l.inventory_error && (
					<div
						className={`${note} text-text-muted flex items-center gap-2 flex-wrap`}
						title='a script on the box, in ~/scripts, that lists its apps as json'
					>
						<span>
							No inventory on this box.{' '}
							<span className='font-mono'>~/scripts/devgo-inventory.sh</span>{' '}
							would list its apps.
						</span>
						<Button
							variant='ghost'
							className='text-11 text-accent hover:bg-transparent px-1'
							onClick={() => onSetup(s)}
						>
							Set up this box…
						</Button>
					</div>
				)}
				{l?.inventory_error && (
					<div className={`${note} text-danger`} title={l.inventory_error}>
						{l.inventory_error}
					</div>
				)}
				{groups.map(({ root, folded, count, hidden, rows }) => (
					<div key={root}>
						{/* a root heading is the same kind of thing as a group heading
						    in the github lane: one step under the rows, and it folds
						    like one */}
						<div
							className={`${row} py-1.5 cursor-pointer hover:bg-bg-hover/40`}
							title={`${count} under ${root}. Click to ${folded ? 'show' : 'hide'}`}
							onClick={() => toggleRoot(s.id, root)}
							onContextMenu={e => {
								e.preventDefault();
								e.stopPropagation();
								onRootContextMenu(s, root, e.clientX, e.clientY);
							}}
						>
							<div className='w-full flex items-center gap-2 pl-10 pr-4'>
								<span
									className={`text-11 shrink-0 ${folded ? 'text-text-muted' : 'text-accent'}`}
								>
									{folded ? '▶' : '▼'}
								</span>
								<span className='truncate font-mono text-13 font-semibold text-text-primary'>
									{root}
								</span>
								<span className='flex-1' />
								<span className='font-mono text-11 text-text-muted shrink-0 w-8 text-right'>
									{count}
								</span>
							</div>
						</div>
						{rows.map(r => (
							<div key={`${s.id}:${r.folder.path}`}>
								<FolderRow
									{...{
										server: s,
										row: r,
										isCursor: folderCursor === `${s.id}:${r.folder.path}`,
										onToggle: (sv: Server, f: RemoteFolder) =>
											toggleDir(sv.id, f.path),
										onSelect: onSelectFolder,
										onOpen: onOpenFolder,
										onContextMenu: onFolderContextMenu
									}}
								/>
								{showAllRow(s, r.folder.path, r.hidden, r.depth + 1)}
							</div>
						))}
						{!folded && showAllRow(s, root, hidden, 0)}
					</div>
				))}
			</div>
		);
	};

	return (
		<div className={`${card} border-t-emerald-400/50 border-l-emerald-400/50`}>
			<LaneHeading
				{...{
					label: 'Servers',
					tone: 'text-emerald-300',
					line: countLine,
					open: isOpen,
					onToggle: toggleOpen,
					onContextMenu: onHeadingContextMenu
				}}
			>
				{/* the lane's own box and its add, when the command row has no
				    column for them: a server, or a folder on one */}
				{searchInHeading && all.length > 0 && (
					<div
						className={searchBoxHeadingSlot}
						onClick={e => e.stopPropagation()}
					>
						<SearchBox
							{...{
								ref: searchRef,
								value: query,
								onChange: setQuery,
								onArrow,
								onEnter,
								enterHint,
								placeholder: 'Search servers & folders…',
								lane: 'servers' as const,
								className: searchBoxHeading
							}}
						/>
					</div>
				)}
				{searchInHeading && (
					// the noun and the caret the command row's Servers ▾ wears, at
					// heading scale: no +, because this adds nothing on the click — it
					// opens a menu, and the glyph was promising a verb it never had.
					// ⚠️ it does repeat the lane's own SERVERS label two words to its
					// left. the alternative was a different word here than on the row
					// form, and one pattern for all three menus is worth more than
					// avoiding that echo.
					// no title: this opens the same menu 4px under itself, and a native
					// tooltip lands on its first entry (see GithubControls). both entries
					// — a server by hand, the ~/.ssh/config import — say what it said
					<Button
						variant='ghost'
						className='gap-1.5 text-11 px-1.5 py-0.5 -my-1'
						onClick={e => {
							e.stopPropagation();
							const r = e.currentTarget.getBoundingClientRect();
							onAddMenu(r.left, r.bottom + 4);
						}}
					>
						<span className='leading-none'>Servers</span>
						<span className='text-11 leading-none opacity-70'>▾</span>
					</Button>
				)}
			</LaneHeading>

			<div
				className='grid transition-[grid-template-rows] duration-150 ease-out min-[1400px]:flex-1 min-[1400px]:min-h-0'
				style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
			>
				<div className='overflow-hidden min-h-0 min-[1400px]:h-full flex flex-col'>
					<div className={`${laneBody} min-[1400px]:h-full`}>
						{all.length === 0 && (
							<div className={`${rowFlat} py-3 text-13 text-text-muted`}>
								No servers yet. Add one, or import{' '}
								<span className='font-mono'>~/.ssh/config</span>.
							</div>
						)}
						{q && visible.length === 0 && (
							<div className={`${rowFlat} py-3 text-13 text-text-muted`}>
								Nothing matches <span className='font-mono'>{q}</span>.
							</div>
						)}
						{visible.map(({ server, groups, open }, i) => (
							<div key={server.id}>
								<ServerRow
									{...{
										server,
										isCursor: cursor === server.id,
										i,
										listing: listings[server.id],
										busy: listing.has(server.id),
										expanded: open,
										showDetails,
										onToggle: (s: Server) => toggleExpanded(s.id),
										onRefresh: (s: Server) => listFolders(s.id).catch(() => {}),
										onSelect,
										onOpen,
										onContextMenu
									}}
								/>
								{open && under(server, groups)}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
};

export default ServersLane;
