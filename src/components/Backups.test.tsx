import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Backups from './Backups';

// the panel reads two caches and renders; its whole contract is WHICH of
// three readings it draws for a given payload, so the mock answers per
// command name and every test asserts on what reached the screen
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...a: unknown[]) => invoke(...(a as []))
}));

const server = (id: string, name: string): Server => ({
	id,
	name,
	alias: null,
	host: `${id}.example.com`,
	user: 'joy',
	port: null,
	identity: null,
	default_path: null,
	tmux: false,
	session: null,
	tunnel: false,
	source: 'manual',
	roots: []
});

const job = (over: Partial<ServerBackupJob>): ServerBackupJob => ({
	name: 'postgres',
	dir: '/home/joy/backups/postgres',
	last_run: Math.floor(Date.now() / 1000) - 7200,
	size_bytes: 39920378,
	retained: 13,
	offsite: null,
	offsite_last: null,
	offsite_target: null,
	last_status: 'success',
	log: null,
	...over
});

// a listing whose inventory carries whatever backups section a test wants
// — undefined for a box whose contract predates the key
const listing = (backups?: ServerBackups | null): ServerListing => ({
	folders: [],
	subdirs: {},
	listed_at: Math.floor(Date.now() / 1000) - 60,
	up: true,
	error: null,
	inventory: {
		schema: backups === undefined ? 1 : 2,
		generated: null,
		host: {
			hostname: 'box',
			uptime: null,
			load: [],
			disk: null,
			pm2_total: 0,
			pm2_online: 0,
			nginx_sites: 0
		},
		apps: [],
		...(backups === undefined ? {} : { backups })
	},
	actions: null,
	inventory_error: null
});

const wire = (servers: Server[], listings: Record<string, ServerListing>) =>
	invoke.mockImplementation((cmd: string) => {
		if (cmd === 'get_servers') return Promise.resolve(servers);
		if (cmd === 'get_server_listings') return Promise.resolve(listings);
		return Promise.resolve(null);
	});

afterEach(cleanup);
beforeEach(() => invoke.mockReset());

// ⭐ these three describes ARE the slice. collapsing the first into the
// third is the failure this panel exists to avoid, and if that is not
// tested it comes back the first time somebody simplifies the ternary
describe('Backups — the contract does not report backups', () => {
	// server_setup reports an edited inventory script as Differs and
	// deliberately refuses to overwrite it, so the users most likely to
	// land here are the ones who cared enough to customise theirs.
	// warning them is crying wolf at exactly the wrong people
	it('says the box was not asked, and does NOT warn', async () => {
		wire([server('a', 'zettalocal')], { a: listing(undefined) });
		render(<Backups onError={() => {}} />);

		expect(
			await screen.findByText(/does not report backups/)
		).not.toBeNull();
		// none of the warning vocabulary — the word, the glyph, the count
		expect(screen.queryByText(/No off-site copy/)).toBeNull();
		expect(screen.queryByText(/without an off-site copy/)).toBeNull();
		expect(document.body.textContent).not.toContain('▲');
	});

	it('treats known:false the same neutral way as a missing key', async () => {
		wire([server('a', 'zettalocal')], { a: listing({ known: false, jobs: [] }) });
		render(<Backups onError={() => {}} />);

		expect(
			await screen.findByText(/does not report backups/)
		).not.toBeNull();
		expect(screen.queryByText(/No off-site copy/)).toBeNull();
	});
});

describe('Backups — reported, a copy leaves the box', () => {
	it('names the target and the retention, and does not warn', async () => {
		wire([server('a', 'zetta')], {
			a: listing({
				known: true,
				jobs: [
					job({
						offsite: true,
						offsite_target: 'gdcrypt:postgres',
						offsite_last: Math.floor(Date.now() / 1000) - 7100
					})
				]
			})
		});
		render(<Backups onError={() => {}} />);

		expect(await screen.findByText('Off-site', { exact: false })).not.toBeNull();
		expect(document.body.textContent).toContain('gdcrypt:postgres');
		expect(document.body.textContent).toContain('13 kept');
		expect(screen.queryByText(/No off-site copy/)).toBeNull();
	});
});

describe('Backups — reported, and nothing leaves the box', () => {
	// the only state that warns, and it is only reachable when the
	// contract affirmatively said offsite:false
	it('warns in the word, not only in the hue', async () => {
		wire([server('a', 'zettalocal')], {
			a: listing({
				known: true,
				jobs: [job({ name: 'ZETTADRIVE', offsite: false, last_status: 'unknown' })]
			})
		});
		render(<Backups onError={() => {}} />);

		// the WORD first: a greyscale reader must get the finding
		expect(await screen.findByText(/No off-site copy/)).not.toBeNull();
		expect(document.body.textContent).toContain('1 without an off-site copy');
		expect(document.body.textContent).toContain('Everything here dies with the disk');
	});

	it('does not warn when the job says offsite:null — nothing said either way', async () => {
		wire([server('a', 'zetta')], {
			a: listing({ known: true, jobs: [job({ name: 'mysql-final', offsite: null })] })
		});
		render(<Backups onError={() => {}} />);

		expect(await screen.findByText(/Off-site not reported/)).not.toBeNull();
		expect(screen.queryByText(/No off-site copy/)).toBeNull();
		expect(screen.queryByText(/without an off-site copy/)).toBeNull();
	});
});

describe('Backups — per server, never one verdict', () => {
	// two boxes with opposite gaps. a single global line over the pair
	// would be wrong about both of them at once
	it('keeps each box on its own reading', async () => {
		wire([server('a', 'zetta'), server('b', 'zettalocal')], {
			a: listing({
				known: true,
				jobs: [job({ offsite: true, offsite_target: 'gdcrypt:postgres' })]
			}),
			b: listing({ known: true, jobs: [job({ name: 'ZETTADRIVE', offsite: false })] })
		});
		render(<Backups onError={() => {}} />);

		expect(await screen.findByText('zetta')).not.toBeNull();
		expect(screen.getByText('zettalocal')).not.toBeNull();
		// exactly one of the two warns
		expect(screen.getAllByText(/No off-site copy/)).toHaveLength(1);
	});

	it('says a box was never listed rather than guessing at it', async () => {
		wire([server('a', 'zetta')], {});
		render(<Backups onError={() => {}} />);

		expect(await screen.findByText(/Not listed yet/)).not.toBeNull();
		expect(screen.queryByText(/No off-site copy/)).toBeNull();
	});

	it('reads the caches only, and opens nothing', async () => {
		wire([], {});
		render(<Backups onError={() => {}} />);

		await screen.findByText('No servers yet.');
		expect(
			invoke.mock.calls.map(c => (c as unknown[])[0]).sort()
		).toEqual(['get_server_listings', 'get_servers']);
	});
});
