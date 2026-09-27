import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ServersLane from './ServersLane';

// no invoke stub here, deliberately, and not an omission: the lane's whole
// import graph — Button, LaneHeading, SearchBox, Kbd, rowStyles, etcCuration,
// serverApps, shortcuts, platform — reaches @tauri-apps/api nowhere. every ask
// this card makes is a function it was handed, so the functions ARE the wire
// and the spies below are the whole contract. nothing is written to
// localStorage either: the open/folded memory lives in useServers, which is
// stubbed out, so there is no global to clear on either side of a test
afterEach(cleanup);

const server = (over: Partial<Server> = {}): Server => ({
	id: 'srv-alpha',
	name: 'alpha',
	alias: null,
	host: 'alpha.example',
	user: 'joy',
	port: null,
	identity: null,
	default_path: null,
	tmux: false,
	session: null,
	tunnel: false,
	source: 'manual',
	roots: [],
	...over
});

const ALPHA = server();
const BRAVO = server({
	id: 'srv-bravo',
	name: 'bravo',
	host: 'bravo.example',
	user: null
});

const listing = (over: Partial<ServerListing> = {}): ServerListing => ({
	folders: [],
	subdirs: {},
	listed_at: Math.floor(Date.now() / 1000),
	up: true,
	error: null,
	inventory: null,
	actions: null,
	inventory_error: null,
	...over
});

const folder = (name: string, root = '/var/www'): RemoteFolder => ({
	name,
	path: `${root}/${name}`,
	root
});

const fRow = (f: RemoteFolder, over: Partial<VisibleFolder> = {}): VisibleFolder => ({
	folder: f,
	depth: 0,
	open: false,
	busy: false,
	...over
});

const group = (
	root: string,
	rows: VisibleFolder[],
	over: Partial<VisibleRoot> = {}
): VisibleRoot => ({
	root,
	folded: false,
	count: rows.length,
	hidden: 0,
	rows,
	...over
});

const app = (over: Partial<ServerApp> = {}): ServerApp => ({
	name: 'shop',
	dir: '/var/www/shop',
	kind: 'next',
	processes: [],
	site: null,
	git: null,
	env_files: [],
	database: null,
	pm: null,
	ecosystem: null,
	...over
});

const proc = (over: Partial<ServerApp['processes'][number]> = {}) => ({
	pm2: 'shop-web',
	docker: null,
	status: 'online',
	restarts: null,
	uptime: null,
	cwd: null,
	ports: [],
	memory_mb: null,
	...over
});

// the asks the lane makes of the hook it was handed. typed parameters and not
// bare vi.fn()s so `toHaveBeenCalledWith('srv-alpha')` is checked by tsc as
// well as at runtime
const asks = () => ({
	toggleOpen: vi.fn(),
	setQuery: vi.fn((_q: string) => {}),
	toggleExpanded: vi.fn((_id: string) => {}),
	listFolders: vi.fn((_id: string) => Promise.resolve(listing())),
	toggleDir: vi.fn((_id: string, _path: string) => {}),
	toggleRoot: vi.fn((_id: string, _root: string) => {}),
	toggleShowAll: vi.fn((_id: string, _path: string) => {})
});

// and the asks it makes of the app above it
const handlers = () => ({
	onSelect: vi.fn((_s: Server) => {}),
	onOpen: vi.fn((_s: Server) => {}),
	onContextMenu: vi.fn((_s: Server, _x: number, _y: number) => {}),
	onAddMenu: vi.fn((_x: number, _y: number) => {}),
	onHeadingContextMenu: vi.fn((_x: number, _y: number) => {}),
	onSelectFolder: vi.fn((_s: Server, _f: RemoteFolder) => {}),
	onOpenFolder: vi.fn((_s: Server, _f: RemoteFolder) => {}),
	onFolderContextMenu: vi.fn(
		(_s: Server, _f: RemoteFolder, _x: number, _y: number) => {}
	),
	onRootContextMenu: vi.fn((_s: Server, _r: string, _x: number, _y: number) => {}),
	onSetup: vi.fn((_s: Server) => {}),
	onArrow: vi.fn((_d: 1 | -1) => {}),
	onEnter: vi.fn()
});

const lane = (
	over: Partial<ServersState> = {},
	props: Partial<ServersLaneProps> = {}
) => {
	const ask = asks();
	const on = handlers();
	const servers: ServersState = {
		servers: [],
		hasSsh: true,
		isOpen: true,
		reload: async () => {},
		add: async () => ALPHA,
		update: async () => {},
		remove: async () => {},
		importSshConfig: async () => ({ added: 0, updated: 0 }),
		showDetails: false,
		setShowDetails: async () => {},
		listings: {},
		listing: new Set<string>(),
		expanded: new Set<string>(),
		listDir: async () => [],
		query: '',
		openDirs: new Set<string>(),
		loadingDirs: new Set<string>(),
		foldedRoots: new Set<string>(),
		showAllIn: new Set<string>(),
		visible: [],
		...ask,
		...over
	};
	render(
		<ServersLane
			{...{
				servers,
				cursor: null,
				folderCursor: null,
				...on,
				...props
			}}
		/>
	);
	return { ...ask, ...on };
};

// one server, open, with whatever sits under it
const opened = (groups: VisibleRoot[], over: Partial<ServersState> = {}) =>
	lane({
		servers: [ALPHA],
		visible: [{ server: ALPHA, open: true, groups }],
		...over
	});

const box = () => screen.getByPlaceholderText('Search servers & folders…');
const expander = () => screen.getByTitle('Show folders on the server');
const refresh = () => screen.getByTitle("List the server's folders again (one ssh)");

// the coordinates a context menu opens at come off the event, and jsdom gives
// every event a point of (0, 0) because it lays nothing out. so every
// right-click below asserts WHICH row asked for the menu and in what order,
// never where the menu would land
const rightClick = (user: ReturnType<typeof userEvent.setup>, el: Element) =>
	user.pointer({ target: el, keys: '[MouseRight]' });

describe('ServersLane — the heading', () => {
	// the count is of the servers the query left, not of every server on
	// record: a lane saying "6 machines" over one row is the lane lying about
	// what it is showing
	it('counts the machines on screen, not the ones on record', () => {
		lane({
			servers: [ALPHA, BRAVO],
			visible: [{ server: ALPHA, open: false, groups: [] }]
		});
		expect(screen.getByText('1 machine')).not.toBeNull();
	});

	it('says none yet before the first server exists', () => {
		lane();
		expect(screen.getByText('none yet')).not.toBeNull();
		expect(screen.getByText(/No servers yet/).textContent).toContain('~/.ssh/config');
	});

	it('names the query when it leaves nothing', () => {
		lane({
			servers: [ALPHA, BRAVO],
			query: '  zeta  ',
			visible: []
		});
		// the count is honest about the empty result too
		expect(screen.getByText('0 machines')).not.toBeNull();
		expect(screen.getByText(/Nothing matches/).textContent).toContain('zeta');
	});

	// ⭐ a query outlives the last server — the hook never clears it, and the
	// command row's box is not gated on the count — so the lane is handed
	// all.length === 0 WITH a live q. it printed both notes then, telling the
	// reader "add your first server" and "your filter matched nothing" at once.
	// the empty-inventory note is the only one that is actionable, so it wins
	// and the filter note stays quiet until there is something to filter
	it('never prints both notes: none-yet wins over a query on an empty lane', () => {
		lane({ servers: [], query: 'zeta', visible: [] });
		expect(screen.getByText(/No servers yet/)).not.toBeNull();
		expect(screen.queryByText(/Nothing matches/)).toBeNull();
	});

	// the whole heading line is the collapse target, so anything interactive
	// sitting IN it has to stop the click. a box that folded the lane away as
	// you clicked into it is the failure
	it('keeps the lane open when the box or the menu button is clicked', async () => {
		const user = userEvent.setup();
		const { toggleOpen, onAddMenu } = lane({
			servers: [ALPHA],
			visible: [{ server: ALPHA, open: false, groups: [] }]
		});

		await user.click(box());
		expect(toggleOpen).not.toHaveBeenCalled();

		await user.click(screen.getByRole('button', { name: /Servers/ }));
		expect(onAddMenu).toHaveBeenCalledTimes(1);
		expect(toggleOpen).not.toHaveBeenCalled();
	});

	it('folds on the heading itself and opens its own menu on a right-click', async () => {
		const user = userEvent.setup();
		const { toggleOpen, onHeadingContextMenu } = lane({
			servers: [ALPHA],
			visible: [{ server: ALPHA, open: false, groups: [] }]
		});

		const line = screen.getByText('1 machine');
		await user.click(line);
		expect(toggleOpen).toHaveBeenCalledTimes(1);

		await rightClick(user, line);
		expect(onHeadingContextMenu).toHaveBeenCalledTimes(1);
	});

	// the box is the lane's, the keys are the tree's: the card forwards and
	// decides nothing. the ENTER chip this box puts up for any text at all is
	// a promise kept by ProjectTree.openServerRow (covered there, at
	// ProjectTree.test.tsx), so what is checked here is only that the key
	// reaches the prop
	it('forwards typing, the arrows and Enter out of its own box', async () => {
		const user = userEvent.setup();
		const { setQuery, onArrow, onEnter } = lane({
			servers: [ALPHA],
			visible: [{ server: ALPHA, open: false, groups: [] }]
		});

		await user.type(box(), 'z');
		expect(setQuery).toHaveBeenCalledWith('z');

		await user.type(box(), '{ArrowDown}{ArrowUp}{Enter}');
		expect(onArrow.mock.calls).toEqual([[1], [-1]]);
		expect(onEnter).toHaveBeenCalledTimes(1);
	});

	// on a wide window the box and the menu live in the command row over the
	// lane instead, and two boxes for one query is the bug
	it('renders no box and no menu button when the command row has them', () => {
		lane(
			{ servers: [ALPHA], visible: [{ server: ALPHA, open: false, groups: [] }] },
			{ searchInHeading: false }
		);
		expect(screen.queryByPlaceholderText('Search servers & folders…')).toBeNull();
		expect(screen.queryByRole('button', { name: /Servers/ })).toBeNull();
	});

	// nothing to search through yet, so the box would be a control over an
	// empty list. the menu button stays: it is the way the first server is added
	it('holds the box back until there is a server, but never the add menu', () => {
		lane();
		expect(screen.queryByPlaceholderText('Search servers & folders…')).toBeNull();
		expect(screen.getByRole('button', { name: /Servers/ })).not.toBeNull();
	});
});

describe('ServersLane — the asks on a server row', () => {
	const one = (over: Partial<ServersState> = {}) =>
		lane({
			servers: [ALPHA],
			visible: [{ server: ALPHA, open: false, groups: [] }],
			...over
		});

	// ⭐ the expander is the ONLY thing that reaches the network on this row's
	// left, and it must not double as a selection: the click that lists a box's
	// folders is not the click that says "this is the row I mean"
	it('expands on the chevron and selects nothing doing it', async () => {
		const user = userEvent.setup();
		const { toggleExpanded, onSelect, onOpen } = one();

		await user.click(expander());
		expect(toggleExpanded).toHaveBeenCalledWith('srv-alpha');
		expect(onSelect).not.toHaveBeenCalled();
		expect(onOpen).not.toHaveBeenCalled();
	});

	it('lists again on ↻ without selecting or opening the row', async () => {
		const user = userEvent.setup();
		const { listFolders, onSelect, onOpen } = one();

		await user.click(refresh());
		expect(listFolders).toHaveBeenCalledWith('srv-alpha');
		expect(onSelect).not.toHaveBeenCalled();
		expect(onOpen).not.toHaveBeenCalled();
	});

	// one ssh at a time: a second ↻ while the first is out would queue a second
	// connection behind it, and the row already says it is working
	it('refuses a second ↻ while one is in flight, and says so on the chevron', async () => {
		const user = userEvent.setup();
		const { listFolders } = one({ listing: new Set(['srv-alpha']) });

		const button = refresh() as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		await user.click(button);
		expect(listFolders).not.toHaveBeenCalled();
		// the chevron is the progress: … in place of ▶/▼
		expect(screen.getByTitle('Show folders on the server').textContent).toBe('…');
	});

	it('selects on the name and opens a terminal on the second click', async () => {
		const user = userEvent.setup();
		const { onSelect, onOpen } = one();

		await user.click(screen.getByText('alpha'));
		expect(onSelect).toHaveBeenCalledWith(ALPHA);

		await user.dblClick(screen.getByText('alpha'));
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen).toHaveBeenCalledWith(ALPHA);
	});

	// the menu's entries act on the row it was opened over, so the selection
	// has to move FIRST — a menu opened on a row while another row is selected
	// is a menu whose entries lie about their target
	it('selects the row before opening its menu on it', async () => {
		const user = userEvent.setup();
		const { onSelect, onContextMenu } = one();

		await rightClick(user, screen.getByTitle('Open a terminal on alpha'));

		expect(onSelect).toHaveBeenCalledWith(ALPHA);
		expect(onContextMenu.mock.calls[0][0]).toBe(ALPHA);
		expect(onSelect.mock.invocationCallOrder[0]).toBeLessThan(
			onContextMenu.mock.invocationCallOrder[0]
		);
	});
});

describe('ServersLane — what a row is willing to say out loud', () => {
	const row = (s: Server, showDetails: boolean) =>
		lane({
			servers: [s],
			showDetails,
			visible: [{ server: s, open: false, groups: [] }]
		});

	// the details switch is off by default because a screenshot of this app
	// should not be a list of where its owner has shell accounts
	it('prints no user@host and no port with the switch off', () => {
		row(server({ port: 2222 }), false);
		expect(screen.queryByText('joy@alpha.example')).toBeNull();
		expect(screen.queryByText(':2222')).toBeNull();
		expect(screen.getByTitle('Open a terminal on alpha')).not.toBeNull();
	});

	it('prints user@host and the ssh line once the switch is on', () => {
		row(server({ port: 2222 }), true);
		expect(screen.getByText('joy@alpha.example')).not.toBeNull();
		expect(screen.getByText(':2222')).not.toBeNull();
		expect(screen.getByTitle('ssh joy@alpha.example')).not.toBeNull();
	});

	// 22 is what ssh does anyway, so printing it is noise dressed as detail
	it('keeps the default port to itself even with the switch on', () => {
		row(server({ port: 22 }), true);
		expect(screen.queryByText(':22')).toBeNull();
	});

	// the alias is the word that actually works in a shell, so it wins the
	// tooltip over anything the row could spell out itself
	it('lets an alias win the ssh line and print beside the name', () => {
		row(server({ alias: 'alpha-prod' }), true);
		expect(screen.getByTitle('ssh alpha-prod')).not.toBeNull();
		expect(screen.getByText('alpha-prod')).not.toBeNull();
	});

	it('does not print an alias that only repeats the name', () => {
		row(server({ alias: 'alpha' }), false);
		expect(screen.getByTitle('ssh alpha')).not.toBeNull();
		expect(screen.getAllByText('alpha')).toHaveLength(1);
	});

	// these two are facts about the connection rather than about where it goes,
	// so they are not the details switch's to hide
	it('prints tunnel and tmux whatever the details switch says', () => {
		row(server({ tunnel: true, tmux: true, session: 'work' }), false);
		expect(screen.getByText('tunnel')).not.toBeNull();
		expect(screen.getByTitle('tmux session work on the server')).not.toBeNull();
	});

	it('names devgo as the tmux session when the config does not', () => {
		row(server({ tmux: true }), false);
		expect(screen.getByTitle('tmux session devgo on the server')).not.toBeNull();
	});
});

describe('ServersLane — the dot is three answers, never two', () => {
	const withListing = (l?: ServerListing) =>
		lane({
			servers: [ALPHA],
			listings: l ? { 'srv-alpha': l } : {},
			visible: [{ server: ALPHA, open: false, groups: [] }]
		});

	// ⭐ the same class of defect GithubLane's login chip had: never asked must
	// not read as an answer. a hollow dot with the words to match is the third
	// state, and it is the one a fresh launch is in
	it('says it has not asked yet when no listing exists', () => {
		withListing();
		expect(screen.getByTitle(/Not checked yet/)).not.toBeNull();
	});

	it('says when it reached the box and how much it found', () => {
		withListing(listing({ folders: [folder('shop'), folder('erp')] }));
		expect(screen.getByTitle(/Reached just now · 2 folders/)).not.toBeNull();
	});

	// the reason is the whole value of a red dot: "unreachable" alone sends the
	// reader to a terminal to find out what this already knows
	it('carries the reason it could not reach the box', () => {
		withListing(
			listing({ up: false, error: 'ssh: connect to host port 22: timed out' })
		);
		const dot = screen.getByTitle(/Unreachable/);
		expect(dot.getAttribute('title')).toContain('timed out');
	});

	it('folds what the inventory knows about the box into the same tooltip', () => {
		withListing(
			listing({
				folders: [folder('shop')],
				inventory: {
					schema: 1,
					generated: null,
					host: {
						hostname: 'alpha',
						uptime: null,
						load: [0.42],
						disk: { total_gb: 80, free_gb: 19 },
						pm2_total: 3,
						pm2_online: 2,
						nginx_sites: 4
					},
					apps: []
				}
			})
		);
		const title = screen.getByTitle(/Reached/).getAttribute('title');
		expect(title).toContain('2/3 pm2 · 4 sites · load 0.42 · 19 GB free');
	});
});

describe('ServersLane — what an open server says when there are no folders', () => {
	const under = (l: ServerListing | undefined, over: Partial<ServersState> = {}) =>
		lane({
			servers: [ALPHA],
			listings: l ? { 'srv-alpha': l } : {},
			visible: [{ server: ALPHA, open: true, groups: [] }],
			...over
		});

	it('repeats the failure under the row, not only in a tooltip', () => {
		under(listing({ up: false, error: 'Permission denied (publickey)' }));
		expect(screen.getByText('Permission denied (publickey)')).not.toBeNull();
	});

	// a reachable box with nothing under it is a settings problem, not a
	// network one, so the note names the roots it looked in and where to change
	// them
	it('names the default roots it found nothing under', () => {
		under(listing({ folders: [] }));
		expect(screen.getByText(/Nothing under/).textContent).toContain(
			'~, ~/projects, /var/www, /srv'
		);
	});

	it('names the server’s own roots instead when it has them', () => {
		lane({
			servers: [server({ roots: ['/opt', '/data'] })],
			listings: { 'srv-alpha': listing({ folders: [] }) },
			visible: [
				{ server: server({ roots: ['/opt', '/data'] }), open: true, groups: [] }
			]
		});
		expect(screen.getByText(/Nothing under/).textContent).toContain('/opt, /data');
	});

	// the busy word is for the FIRST listing only: once a cache exists the
	// rows paint and the chevron carries the progress instead
	it('says Listing… only while there is no cache to paint', () => {
		under(undefined, { listing: new Set(['srv-alpha']) });
		expect(screen.getByText('Listing…')).not.toBeNull();

		cleanup();
		under(listing({ folders: [folder('shop')] }), {
			listing: new Set(['srv-alpha'])
		});
		expect(screen.queryByText('Listing…')).toBeNull();
	});

	// a box without the script still lists its folders, so this is a quiet
	// offer and not an error — and the install it offers is the app's to run
	it('offers the inventory script once, and hands the setup upward', async () => {
		const user = userEvent.setup();
		const { onSetup } = under(listing({ folders: [folder('shop')] }));

		expect(screen.getByText(/No inventory on this box/).textContent).toContain(
			'~/scripts/devgo-inventory.sh'
		);
		await user.click(screen.getByRole('button', { name: 'Set up this box…' }));
		expect(onSetup).toHaveBeenCalledWith(ALPHA);
	});

	// the script ran and failed: that is an answer, and the offer to install
	// one would be the wrong sentence over it
	it('shows the script’s own failure instead of the offer', () => {
		under(listing({ folders: [], inventory_error: 'jq: command not found' }));
		expect(screen.getByText('jq: command not found')).not.toBeNull();
		expect(screen.queryByText(/No inventory on this box/)).toBeNull();
	});
});

describe('ServersLane — the root groups', () => {
	it('prints each root with how many sit under it and folds on the click', async () => {
		const user = userEvent.setup();
		const { toggleRoot } = opened([
			group('/var/www', [fRow(folder('shop')), fRow(folder('erp'))])
		]);

		const heading = screen.getByTitle('2 under /var/www. Click to hide');
		expect(screen.getByText('/var/www')).not.toBeNull();
		await user.click(heading);
		expect(toggleRoot).toHaveBeenCalledWith('srv-alpha', '/var/www');
	});

	// the count survives the fold, because it is the reason to unfold
	it('keeps the count on a folded root and shows none of its rows', () => {
		opened([group('/var/www', [], { folded: true, count: 2 })]);
		expect(screen.getByTitle('2 under /var/www. Click to show')).not.toBeNull();
		expect(screen.queryByText('shop')).toBeNull();
	});

	it('opens the root’s own menu without folding it', async () => {
		const user = userEvent.setup();
		const { toggleRoot, onRootContextMenu } = opened([
			group('/var/www', [fRow(folder('shop'))])
		]);

		await rightClick(user, screen.getByTitle('1 under /var/www. Click to hide'));

		expect(onRootContextMenu.mock.calls[0][0]).toBe(ALPHA);
		expect(onRootContextMenu.mock.calls[0][1]).toBe('/var/www');
		expect(toggleRoot).not.toHaveBeenCalled();
	});
});

describe('ServersLane — a folder row', () => {
	const SHOP = folder('shop');

	it('looks inside on the chevron and selects nothing doing it', async () => {
		const user = userEvent.setup();
		const { toggleDir, onSelectFolder } = opened([group('/var/www', [fRow(SHOP)])]);

		await user.click(screen.getByTitle('Look inside (one ssh)'));
		expect(toggleDir).toHaveBeenCalledWith('srv-alpha', '/var/www/shop');
		expect(onSelectFolder).not.toHaveBeenCalled();
	});

	it('selects on the name and opens on the second click', async () => {
		const user = userEvent.setup();
		const { onSelectFolder, onOpenFolder } = opened([
			group('/var/www', [fRow(SHOP)])
		]);

		await user.click(screen.getByText('shop'));
		expect(onSelectFolder).toHaveBeenCalledWith(ALPHA, SHOP);

		await user.dblClick(screen.getByText('shop'));
		expect(onOpenFolder).toHaveBeenCalledTimes(1);
		expect(onOpenFolder).toHaveBeenCalledWith(ALPHA, SHOP);
	});

	it('selects the folder before opening its menu, same as a server row', async () => {
		const user = userEvent.setup();
		const { onSelectFolder, onFolderContextMenu } = opened([
			group('/var/www', [fRow(SHOP)])
		]);

		await rightClick(user, screen.getByTitle('/var/www/shop'));

		expect(onSelectFolder).toHaveBeenCalledWith(ALPHA, SHOP);
		expect(onFolderContextMenu.mock.calls[0][1]).toBe(SHOP);
		expect(onSelectFolder.mock.invocationCallOrder[0]).toBeLessThan(
			onFolderContextMenu.mock.invocationCallOrder[0]
		);
	});

	// an opened folder that came back empty has to SAY so: the chevron alone
	// flipping to ▼ over nothing reads as a listing that is still running
	it('says an opened folder is empty rather than showing nothing', () => {
		opened([group('/var/www', [fRow(SHOP, { open: true, inside: 0 })])]);
		expect(screen.getByText('no folders inside')).not.toBeNull();
	});

	it('prints how many children an opened folder has', () => {
		opened([group('/srv', [fRow(SHOP, { open: true, inside: 7 })])]);
		expect(screen.getByText('7')).not.toBeNull();
	});

	// what the inventory adds to a folder that is an app: the first domain with
	// every domain in its tooltip, and the site's two ports
	it('adds the app’s domain and the site’s ports', () => {
		opened([
			group('/var/www', [
				fRow(SHOP, {
					app: app({
						site: {
							file: 'shop.conf',
							domains: ['shop.example', 'www.shop.example'],
							ssl: true,
							web_port: 3000,
							api_port: 4000
						},
						processes: [proc({ restarts: 2 })],
						git: {
							repo: null,
							branch: 'main',
							head: 'ab12cd3',
							subject: 'ship the cart'
						}
					})
				})
			])
		]);

		const domain = screen.getByText('shop.example');
		expect(domain.getAttribute('title')).toBe('shop.example, www.shop.example');
		expect(screen.getByText('3000/4000')).not.toBeNull();

		// the tooltip is the whole of what the box said about this app
		const title = screen.getByTitle(/shop-web online/).getAttribute('title');
		expect(title).toContain('shop-web online · 2 restarts');
		expect(title).toContain('site shop.conf · https');
		expect(title).toContain('main @ ab12cd3 ship the cart');
		expect(title).toContain('/var/www/shop');
	});

	// no nginx site, so the ports can only come from the processes themselves —
	// and a container has no pm2 name, so its docker name has to stand in
	it('falls back to the processes’ own ports and names', () => {
		opened([
			group('/var/www', [
				fRow(SHOP, {
					app: app({
						site: null,
						processes: [
							proc({ pm2: null, docker: 'shop-db', status: 'exited', ports: [5432] }),
							proc({ ports: [3001] })
						]
					})
				})
			])
		]);

		expect(screen.getByText('5432/3001')).not.toBeNull();
		expect(screen.getByTitle(/shop-db exited/)).not.toBeNull();
	});

	// a deploy directory the inventory knows but nothing runs in and nothing
	// fronts has nothing new to say, and a row of empty ornaments would only
	// claim otherwise
	it('adds nothing at all for an app with no process and no site', () => {
		opened([
			group('/var/www', [
				fRow(folder('bare'), { app: app({ dir: '/var/www/bare' }) })
			])
		]);
		expect(screen.getByTitle('/var/www/bare').textContent).toBe('▶bare');
	});
});

describe('ServersLane — /etc is curated, and the way back is the same row', () => {
	it('offers the folders the curation left out, as a count you can click', async () => {
		const user = userEvent.setup();
		const { toggleShowAll } = opened([
			group('/etc', [fRow(folder('nginx', '/etc'))], { count: 41, hidden: 23 })
		]);

		await user.click(screen.getByText('23 more system folders. Show all'));
		expect(toggleShowAll).toHaveBeenCalledWith('srv-alpha', '/etc');
	});

	// lifted, the hook reports nothing hidden — so the row has to come back
	// from showAllIn or there is no way out of the full list
	it('turns into the way back once the full list is showing', async () => {
		const user = userEvent.setup();
		const { toggleShowAll } = opened(
			[group('/etc', [fRow(folder('nginx', '/etc'))], { count: 41, hidden: 0 })],
			{ showAllIn: new Set(['srv-alpha:/etc']) }
		);

		await user.click(screen.getByText('Show developer folders only'));
		expect(toggleShowAll).toHaveBeenCalledWith('srv-alpha', '/etc');
	});

	// only /etc is curated: inside /etc/nginx every file is the point, so a
	// lifted flag on any other parent must not print a row offering to narrow
	// a list that was never narrowed
	it('offers nothing on a root that was never curated', () => {
		opened([group('/var/www', [fRow(folder('shop'))], { hidden: 0 })], {
			showAllIn: new Set(['srv-alpha:/var/www'])
		});
		expect(screen.queryByText('Show developer folders only')).toBeNull();
	});
});
