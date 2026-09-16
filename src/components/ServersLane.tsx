import Button from './Button';
import { card, col } from './rowStyles';

// where the row reaches: user@host, or the host alone
const whoAt = (s: Server) => (s.user ? `${s.user}@${s.host}` : s.host);

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

// a server in the same four columns a project uses: where it reaches in
// the workspace column, the name where the location goes, SSH as its
// file system, and the meta cell on the right
const ServerRow = ({
	server,
	isCursor,
	onSelect,
	onOpen,
	onContextMenu
}: ServerRowProps) => (
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
		<div className='truncate font-mono text-13 text-text-muted'>
			{whoAt(server)}
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
				<span className='text-11 text-text-muted shrink-0'>{server.alias}</span>
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
		</div>
	</div>
);

// the machines you ssh into, as one more card in the table: a header that
// collapses like a workspace's, one row per server. nothing here touches
// the network; a row is an alias, and the network happens in the terminal
const ServersLane = ({
	servers,
	cursor,
	onSelect,
	onOpen,
	onContextMenu,
	onAddMenu
}: ServersLaneProps) => {
	const { servers: list, isOpen, toggleOpen } = servers;
	const countLine =
		list.length === 0
			? 'none yet'
			: `${list.length} ${list.length === 1 ? 'machine' : 'machines'}`;

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
				<div />
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
					{list.length === 0 && (
						<div className='px-3 py-2 text-15 text-text-muted'>
							No servers yet. Add one, or import{' '}
							<span className='font-mono'>~/.ssh/config</span>.
						</div>
					)}
					{list.map(server => (
						<ServerRow
							key={server.id}
							{...{
								server,
								isCursor: cursor === server.id,
								onSelect,
								onOpen,
								onContextMenu
							}}
						/>
					))}
				</div>
			</div>
		</div>
	);
};

export default ServersLane;
