import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useServers } from './useServers';

// the hook's whole contract is WHICH rust command it calls, WHEN, and with
// WHAT — none of which tsc can see — so the mock answers per command name
// and the tests assert on the call log, exactly as WslDoctor.test.tsx does
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

const onError = vi.fn();

const SERVER = (over: Partial<Server> = {}): Server => ({
	id: 'a',
	name: 'apex',
	alias: null,
	host: '10.0.0.1',
	user: 'root',
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

const FOLDER = (path: string, root: string): RemoteFolder => ({
	name: path.split('/').filter(Boolean).pop() ?? path,
	path,
	root
});

const LISTING = (
	folders: RemoteFolder[],
	over: Partial<ServerListing> = {}
): ServerListing => ({
	folders,
	subdirs: {},
	listed_at: 1,
	up: true,
	error: null,
	inventory: null,
	actions: null,
	inventory_error: null,
	...over
});

type Wired = {
	servers?: Server[];
	hasSsh?: boolean;
	listings?: Record<string, ServerListing>;
	/// what an explicit list_server_folders answers with
	folders?: ServerListing;
	/// what a drill answers with
	dir?: RemoteFolder[];
	/// commands that reject, the way a box that is down rejects
	fail?: string[];
};

// one place that decides what each command answers, so a test changes the
// one answer it cares about and inherits the rest
const wire = (over: Wired = {}) =>
	invoke.mockImplementation((cmd: string) => {
		if (over.fail?.includes(cmd))
			return Promise.reject(new Error(`${cmd} refused`));
		switch (cmd) {
			case 'get_servers':
				return Promise.resolve(over.servers ?? []);
			case 'has_ssh':
				return Promise.resolve(over.hasSsh ?? true);
			case 'get_server_listings':
				return Promise.resolve(over.listings ?? {});
			case 'get_show_server_details':
				return Promise.resolve(false);
			case 'set_show_server_details':
				return Promise.resolve(true);
			case 'list_server_folders':
				return Promise.resolve(over.folders ?? LISTING([]));
			case 'list_server_dir':
				return Promise.resolve(over.dir ?? []);
			case 'add_server':
				return Promise.resolve(SERVER({ id: 'new' }));
			case 'import_ssh_config':
				return Promise.resolve([2, 1]);
			default:
				return Promise.resolve(null);
		}
	});

const called = (cmd: string) =>
	invoke.mock.calls.filter(c => (c as unknown[])[0] === cmd).length;
const arg = (cmd: string) =>
	invoke.mock.calls.find(c => (c as unknown[])[0] === cmd)?.[1];

// the mount fires three commands whose answers each land a setState; two
// microtask turns is enough for every `.then` in the file
const flush = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});

const mount = async (over: Wired = {}) => {
	wire(over);
	const h = renderHook(() => useServers(onError));
	await flush();
	return h;
};

beforeEach(() => {
	invoke.mockReset();
	onError.mockReset();
	localStorage.clear();
});
afterEach(() => localStorage.clear());

describe('useServers — what launch is allowed to cost', () => {
	// ⛔ the rule the hook's own header states: a listing is an ssh, and
	// launch must not spend one per box. three local reads, no network
	it('reads the rows, the client and the cached listings, and sshes nowhere', async () => {
		await mount({ servers: [SERVER()] });

		expect(called('get_servers')).toBe(1);
		expect(called('has_ssh')).toBe(1);
		expect(called('get_server_listings')).toBe(1);
		expect(called('list_server_folders')).toBe(0);
		expect(called('list_server_dir')).toBe(0);
	});

	// servers.json unreadable is a state, not a crash: the card renders
	// empty and reload's promise still resolves, so App's callers do not see
	// a rejection they never asked for
	it('keeps an empty list and a resolving reload when rust cannot read servers.json', async () => {
		const { result } = await mount({ fail: ['get_servers'] });

		expect(result.current.servers).toEqual([]);
		let threw = false;
		await act(async () => {
			await result.current.reload().catch(() => {
				threw = true;
			});
		});
		expect(threw).toBe(false);
	});
});

describe('useServers — the query decides what exists', () => {
	const two = [SERVER(), SERVER({ id: 'b', name: 'beta', host: '10.0.0.2' })];

	it('leaves visible empty for a query nothing answers', async () => {
		const { result } = await mount({ servers: two });

		act(() => result.current.setQuery('zzzzz'));
		expect(result.current.visible).toEqual([]);
	});

	// a server is four strings, not one: a box that only searched `name`
	// hides a row whose alias is the only thing anyone types
	it('matches on alias, host and user, not only the name', async () => {
		const { result } = await mount({
			servers: [SERVER({ alias: 'prod-box' })]
		});

		for (const q of ['prod-box', '10.0.0', 'root', 'apex']) {
			act(() => result.current.setQuery(q));
			expect(result.current.visible.length).toBe(1);
		}
	});

	// a folder hit has to bring its server AND open it, or the hit renders
	// under a collapsed row and the search box looks broken
	it('opens a collapsed server that has a folder hit', async () => {
		const { result } = await mount({
			servers: [SERVER()],
			listings: { a: LISTING([FOLDER('/var/www/shop', '/var/www')]) }
		});

		expect(result.current.expanded.has('a')).toBe(false);
		act(() => result.current.setQuery('shop'));
		const [row] = result.current.visible;
		expect(row.open).toBe(true);
		expect(row.groups[0].rows.map(r => r.folder.name)).toEqual(['shop']);
	});

	// ⭐ `visible` is computed with no reference to isOpen: the hook answers
	// "what would the card show", and every CALLER has to gate on isOpen
	// itself (ProjectTree.tsx:618 does — `servers?.isOpen ? servers.visible :
	// []`). pinned here because it is the near half of the ENTER-chip bug: a
	// cursor set while the lane was open is not cleared by closing it, so the
	// key map still routes Enter at a row that has left the walk
	it('hands out every server with the lane closed — the caller does the gating', async () => {
		const { result } = await mount({ servers: two });

		expect(result.current.visible.length).toBe(2);
		act(() => result.current.toggleOpen());
		expect(result.current.isOpen).toBe(false);
		expect(result.current.visible.length).toBe(2);
	});
});

describe('useServers — the order of the root groups', () => {
	// ls -d sorts every matched path together, so the order rust hands back
	// is alphabetical across roots: /etc/* came out above /home/user/* the
	// moment /etc was a root. the groups must follow the SERVER's declared
	// roots instead
	it('follows the server roots, not the order the listing arrived in', async () => {
		const { result } = await mount({
			servers: [SERVER({ roots: ['/var/www', '/etc'] })],
			listings: {
				a: LISTING([
					FOLDER('/etc/nginx', '/etc'),
					FOLDER('/var/www/shop', '/var/www')
				])
			}
		});

		act(() => result.current.toggleExpanded('a'));
		expect(result.current.visible[0].groups.map(g => g.root)).toEqual([
			'/var/www',
			'/etc'
		]);
	});

	it('sorts a root the server never declared after the ones it did', async () => {
		const { result } = await mount({
			servers: [SERVER({ roots: ['/var/www'] })],
			listings: {
				a: LISTING([
					FOLDER('/opt/thing', '/opt'),
					FOLDER('/var/www/shop', '/var/www')
				])
			}
		});

		act(() => result.current.toggleExpanded('a'));
		expect(result.current.visible[0].groups.map(g => g.root)).toEqual([
			'/var/www',
			'/opt'
		]);
	});
});

describe('useServers — /etc is curated, and a search lifts the curation', () => {
	const etc = {
		servers: [SERVER({ roots: ['/etc'] })],
		listings: {
			a: LISTING([
				FOLDER('/etc/nginx', '/etc'),
				FOLDER('/etc/apparmor.d', '/etc')
			])
		}
	};

	// a hundred-odd folders, a dozen a developer opens. the count still says
	// two, so the row is not lying about what is on the box
	it('shows the developer folders and counts what it left out', async () => {
		const { result } = await mount(etc);

		act(() => result.current.toggleExpanded('a'));
		const [group] = result.current.visible[0].groups;
		expect(group.rows.map(r => r.folder.name)).toEqual(['nginx']);
		expect(group.hidden).toBe(1);
		expect(group.count).toBe(2);
	});

	it('shows all of them once this parent is opened up', async () => {
		const { result } = await mount(etc);

		act(() => result.current.toggleExpanded('a'));
		act(() => result.current.toggleShowAll('a', '/etc'));
		const [group] = result.current.visible[0].groups;
		expect(group.rows.length).toBe(2);
		expect(group.hidden).toBe(0);
	});

	// a hit is a hit: typing the name of a curated-away folder must find it,
	// or the curation becomes a way to hide things from search
	it('finds a curated-away folder when it is typed', async () => {
		const { result } = await mount(etc);

		act(() => result.current.setQuery('apparmor'));
		expect(
			result.current.visible[0].groups[0].rows.map(r => r.folder.name)
		).toEqual(['apparmor.d']);
	});
});

describe('useServers — expanding is the ask, once', () => {
	it('sshes on the first expand and paints from the cache after', async () => {
		const { result } = await mount({
			servers: [SERVER()],
			folders: LISTING([FOLDER('/var/www/shop', '/var/www')])
		});

		act(() => result.current.toggleExpanded('a'));
		await flush();
		expect(called('list_server_folders')).toBe(1);
		expect(arg('list_server_folders')).toEqual({ id: 'a' });
		// and the answer is remembered, so collapse + expand is free
		act(() => result.current.toggleExpanded('a'));
		act(() => result.current.toggleExpanded('a'));
		await flush();
		expect(called('list_server_folders')).toBe(1);
	});

	it('remembers which servers were expanded across a session', async () => {
		const { result } = await mount({ servers: [SERVER()] });

		act(() => result.current.toggleExpanded('a'));
		expect(localStorage.getItem('devgo.serversExpanded')).toBe('["a"]');
		act(() => result.current.toggleExpanded('a'));
		expect(localStorage.getItem('devgo.serversExpanded')).toBe('[]');
	});

	// the spinner is a Set the row reads; a rejected ask that leaves the id
	// in it is a row that spins until the app restarts
	it('takes the busy mark off a row whose listing failed', async () => {
		const { result } = await mount({
			servers: [SERVER()],
			fail: ['list_server_folders']
		});

		let err: unknown = null;
		await act(async () => {
			await result.current.listFolders('a').catch(e => {
				err = e;
			});
		});
		expect(err).toBeInstanceOf(Error);
		expect(result.current.listing.size).toBe(0);
	});
});

describe('useServers — drilling into a folder', () => {
	const one = {
		servers: [SERVER()],
		listings: { a: LISTING([FOLDER('/var/www/shop', '/var/www')]) }
	};

	// a box that is down otherwise shows an open folder with nothing under
	// it, which reads as an empty directory
	it('closes the arrow again and says why when the drill fails', async () => {
		const { result } = await mount({ ...one, fail: ['list_server_dir'] });

		act(() => result.current.toggleDir('a', '/var/www/shop'));
		await flush();
		expect(result.current.openDirs.has('a:/var/www/shop')).toBe(false);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
	});

	it('sends the id and the absolute path, and opens the arrow on success', async () => {
		const { result } = await mount({
			...one,
			dir: [FOLDER('/var/www/shop/api', '/var/www')]
		});

		act(() => result.current.toggleDir('a', '/var/www/shop'));
		await flush();
		expect(arg('list_server_dir')).toEqual({
			id: 'a',
			path: '/var/www/shop'
		});
		expect(result.current.openDirs.has('a:/var/www/shop')).toBe(true);
		expect(onError).not.toHaveBeenCalled();
	});

	// children already on the listing are the cache; re-asking on every open
	// is an ssh per click
	it('asks nothing when the children are already cached', async () => {
		const { result } = await mount({
			servers: [SERVER()],
			listings: {
				a: LISTING([FOLDER('/var/www/shop', '/var/www')], {
					subdirs: {
						'/var/www/shop': [FOLDER('/var/www/shop/api', '/var/www')]
					}
				})
			}
		});

		act(() => result.current.toggleDir('a', '/var/www/shop'));
		await flush();
		expect(called('list_server_dir')).toBe(0);
		expect(result.current.openDirs.has('a:/var/www/shop')).toBe(true);
	});

	it('takes the busy mark off a folder whose drill failed', async () => {
		const { result } = await mount({ ...one, fail: ['list_server_dir'] });

		let err: unknown = null;
		await act(async () => {
			await result.current.listDir('a', '/var/www/shop').catch(e => {
				err = e;
			});
		});
		expect(err).toBeInstanceOf(Error);
		expect(result.current.loadingDirs.size).toBe(0);
	});
});

describe('useServers — the writes and their payloads', () => {
	const draft: ServerDraft = {
		name: 'new',
		alias: null,
		host: 'h',
		user: null,
		port: null,
		identity: null,
		default_path: null,
		tmux: false,
		session: null,
		tunnel: false,
		source: 'manual',
		roots: []
	};

	// rust mints the id; the form must not invent one, and the list must be
	// re-read rather than predicted
	it('adds with an empty id and repaints from what rust stored', async () => {
		const { result } = await mount();

		await act(async () => {
			await result.current.add(draft);
		});
		expect(arg('add_server')).toEqual({ server: { ...draft, id: '' } });
		expect(called('get_servers')).toBe(2);
	});

	// ⭐ the guard that stops a bad write becoming a bad list: a refused add
	// must leave the card showing what is really in servers.json
	it('does not repaint the list when rust refuses the add', async () => {
		const { result } = await mount({ fail: ['add_server'] });

		let err: unknown = null;
		await act(async () => {
			await result.current.add(draft).catch(e => {
				err = e;
			});
		});
		expect(err).toBeInstanceOf(Error);
		expect(called('get_servers')).toBe(1);
	});

	it('sends the whole row on an edit and only the id on a remove', async () => {
		const { result } = await mount({ servers: [SERVER()] });

		const row = SERVER({ name: 'renamed' });
		await act(async () => {
			await result.current.update(row);
		});
		expect(arg('update_server')).toEqual({ server: row });

		await act(async () => {
			await result.current.remove('a');
		});
		expect(arg('remove_server')).toEqual({ id: 'a' });
		expect(called('get_servers')).toBe(3);
	});

	// the toast says a number, so the number has to be rust's tuple and not
	// a count of anything this hook can see
	it('reports the counts the import returned', async () => {
		const { result } = await mount();

		let counts: { added: number; updated: number } | null = null;
		await act(async () => {
			counts = await result.current.importSshConfig();
		});
		expect(counts).toEqual({ added: 2, updated: 1 });
		expect(called('get_servers')).toBe(2);
	});
});
