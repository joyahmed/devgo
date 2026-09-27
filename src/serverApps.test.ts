import { describe, expect, it } from 'vitest';
import {
	appForFolder,
	appStatus,
	canFill,
	fillLabel,
	placeholders,
	prefillValues,
	whenHolds
} from './serverApps';

// pure mirror of the rust contract (server_apps.rs): no DOM, no timers, no
// platform branch, no @tauri-apps import anywhere in this graph — so there is
// nothing to stub and nothing to reset between tests.
//
// exact strings are used where the string IS the contract — 'turbo' for a
// mono repo, '0' for port zero, the literal '{pm2_api}' a null value leaves
// behind. relative assertions are used where the point is which process wins
// a slot, or that the positional fallback is order-driven rather than
// name-driven.

type Proc = ServerApp['processes'][number];
type Site = NonNullable<ServerApp['site']>;

const proc = (over: Partial<Proc> = {}): Proc => ({
	pm2: null,
	docker: null,
	status: 'online',
	restarts: 0,
	uptime: 1,
	cwd: null,
	ports: [],
	memory_mb: null,
	...over
});

const site = (over: Partial<Site> = {}): Site => ({
	file: 'shop.conf',
	domains: ['shop.example.com'],
	ssl: true,
	web_port: 3008,
	api_port: 3009,
	...over
});

const app = (over: Partial<ServerApp> = {}): ServerApp => ({
	name: 'shop',
	dir: '/var/www/shop',
	kind: 'mono',
	processes: [],
	site: null,
	git: null,
	env_files: [],
	database: null,
	pm: null,
	ecosystem: null,
	...over
});

// a full app, the way a turbo deploy actually reads: every placeholder filled
const shop = () =>
	app({
		processes: [
			proc({ pm2: 'shop-web', cwd: '/var/www/shop/apps/web' }),
			proc({ pm2: 'shop-api', cwd: '/var/www/shop/apps/api' })
		],
		site: site(),
		git: { repo: 'user/shop', branch: 'main', head: 'abc', subject: 'x' },
		database: { engine: 'postgres', name: 'shop' },
		pm: 'pnpm',
		ecosystem: 'ecosystem.config.js'
	});

const listing = (apps: ServerApp[]): ServerListing => ({
	folders: [],
	subdirs: {},
	listed_at: 0,
	up: true,
	error: null,
	inventory: {
		schema: 2,
		generated: null,
		host: {
			hostname: null,
			uptime: null,
			load: [],
			disk: null,
			pm2_total: 0,
			pm2_online: 0,
			nginx_sites: 0
		},
		apps
	},
	actions: null,
	inventory_error: null
});

const field = (
	over: Partial<ServerActionField> & { name: string }
): ServerActionField => ({
	label: null,
	type: 'text',
	required: false,
	default: null,
	options: [],
	prefill: null,
	when: null,
	arg: null,
	arg_off: null,
	hint: null,
	...over
});

const action = (fields: ServerActionField[]): ServerAction => ({
	id: 'new-site',
	label: 'New site…',
	kind: 'form',
	root: false,
	command: '',
	group: null,
	fields,
	preview: null,
	submit: null
});

describe('appForFolder — which app a folder row is', () => {
	it('finds the app whose dir is the row, and nothing for a row no app owns', () => {
		const l = listing([app({ name: 'shop' }), app({ name: 'blog', dir: '/var/www/blog' })]);
		expect(appForFolder(l, '/var/www/shop')?.name).toBe('shop');
		expect(appForFolder(l, '/var/www/blog')?.name).toBe('blog');
		expect(appForFolder(l, '/var/www/wiki')).toBeUndefined();
	});

	it('ignores trailing slashes on either side of the comparison', () => {
		const l = listing([app({ dir: '/var/www/shop/' })]);
		expect(appForFolder(l, '/var/www/shop')?.name).toBe('shop');
		expect(appForFolder(l, '/var/www/shop/')?.name).toBe('shop');
		expect(appForFolder(l, '/var/www/shop///')?.name).toBe('shop');
	});

	it('matches the whole dir, never a prefix of it', () => {
		// the row a prefix match would wrongly claim: /var/www/shop-old is its
		// own deploy, not the shop one
		const l = listing([app({ dir: '/var/www/shop' })]);
		expect(appForFolder(l, '/var/www/shop-old')).toBeUndefined();
		expect(appForFolder(l, '/var/www/shop/apps/web')).toBeUndefined();
		expect(appForFolder(l, '/var/www')).toBeUndefined();
	});

	it('answers undefined for a box with no listing and for one with no inventory script', () => {
		expect(appForFolder(undefined, '/var/www/shop')).toBeUndefined();
		expect(
			appForFolder({ ...listing([]), inventory: null }, '/var/www/shop')
		).toBeUndefined();
	});
});

describe('placeholders — the words an action line may use', () => {
	it('names the web and api pm2 processes from their suffixes', () => {
		const v = placeholders(shop());
		expect(v.pm2_web).toBe('shop-web');
		expect(v.pm2_api).toBe('shop-api');
		// {pm2} is the generic one and means the web process
		expect(v.pm2).toBe(v.pm2_web);
	});

	it('reads the suffix, not the listed order — an api declared first still fills pm2_api', () => {
		const v = placeholders(
			app({ processes: [proc({ pm2: 'shop-api' }), proc({ pm2: 'shop-web' })] })
		);
		expect(v.pm2_web).toBe('shop-web');
		expect(v.pm2_api).toBe('shop-api');
	});

	it('accepts frontend and backend as the same two slots', () => {
		const v = placeholders(
			app({
				processes: [proc({ pm2: 'shop-backend' }), proc({ pm2: 'shop-frontend' })]
			})
		);
		expect(v.pm2_web).toBe('shop-frontend');
		expect(v.pm2_api).toBe('shop-backend');
	});

	it('falls back to the cwd when the process name carries no hint', () => {
		const v = placeholders(
			app({
				processes: [
					proc({ pm2: 'shop-1', cwd: '/var/www/shop/apps/api/' }),
					proc({ pm2: 'shop-2', cwd: '/var/www/shop/apps/web' })
				]
			})
		);
		// trailing slash on the cwd does not hide the suffix
		expect(v.pm2_api).toBe('shop-1');
		expect(v.pm2_web).toBe('shop-2');
	});

	it('falls back to declared order when neither name nor cwd says anything: first is web, second is api', () => {
		const procs = [proc({ pm2: 'alpha' }), proc({ pm2: 'beta' }), proc({ pm2: 'gamma' })];
		const v = placeholders(app({ processes: procs }));
		expect(v.pm2_web).toBe(procs[0].pm2);
		expect(v.pm2_api).toBe(procs[1].pm2);
		// and the third process fills no slot at all
		expect(Object.values(v)).not.toContain('gamma');
	});

	it('leaves pm2_api null when the app runs a single unhinted process', () => {
		const v = placeholders(app({ processes: [proc({ pm2: 'solo' })] }));
		expect(v.pm2_web).toBe('solo');
		expect(v.pm2_api).toBeNull();
	});

	it('gives an api-only app that api as its web process too', () => {
		// documented behaviour, not an accident: {pm2} must name *something*
		// for a one-process app, and the only named process is the api
		const v = placeholders(app({ processes: [proc({ pm2: 'shop-api' })] }));
		expect(v.pm2_api).toBe('shop-api');
		expect(v.pm2_web).toBe('shop-api');
	});

	it('skips a docker-only process, which has no pm2 name to offer', () => {
		const v = placeholders(
			app({
				processes: [
					proc({ pm2: null, docker: 'shop_web_1', cwd: '/srv/shop/web' }),
					proc({ pm2: 'shop-worker' })
				]
			})
		);
		// the docker row matched 'web' by cwd but has no pm2, so the slot falls
		// through to the first *named* process
		expect(v.pm2_web).toBe('shop-worker');
		expect(v.pm2_api).toBeNull();
	});

	it('leaves every pm2 slot null for an app that runs nothing', () => {
		const v = placeholders(app());
		expect(v.pm2).toBeNull();
		expect(v.pm2_web).toBeNull();
		expect(v.pm2_api).toBeNull();
	});

	it('stringifies the ports, and keeps port 0 rather than reading it as absent', () => {
		expect(placeholders(app({ site: site() })).web_port).toBe('3008');
		// the test that a truthiness check would fail: 0 is a port the site
		// declared, and '0' is what the line must carry
		const zero = placeholders(app({ site: site({ web_port: 0, api_port: 0 }) }));
		expect(zero.web_port).toBe('0');
		expect(zero.api_port).toBe('0');
	});

	it('leaves a port null when the site declares none, and when there is no site at all', () => {
		expect(placeholders(app({ site: site({ api_port: null }) })).api_port).toBeNull();
		const bare = placeholders(app());
		expect(bare.web_port).toBeNull();
		expect(bare.api_port).toBeNull();
		expect(bare.site).toBeNull();
		expect(bare.domain).toBeNull();
	});

	it('takes the first domain only, and null when the site lists none', () => {
		expect(
			placeholders(app({ site: site({ domains: ['a.io', 'www.a.io'] }) })).domain
		).toBe('a.io');
		expect(placeholders(app({ site: site({ domains: [] }) })).domain).toBeNull();
	});

	it('reads an empty string as absent for the file, the package manager and the ecosystem', () => {
		const v = placeholders(
			app({ site: site({ file: '' }), pm: '', ecosystem: '' })
		);
		expect(v.site).toBeNull();
		expect(v.pm).toBeNull();
		expect(v.eco).toBeNull();
	});

	it('pulls db, repo, dir and name straight off the app, null when the probe found nothing', () => {
		const v = placeholders(shop());
		expect(v.dir).toBe('/var/www/shop');
		expect(v.name).toBe('shop');
		expect(v.db).toBe('shop');
		expect(v.repo).toBe('user/shop');
		// a probe that ran and found nothing is the same answer as no probe:
		// null, so the action hides either way
		const bare = placeholders(
			app({
				database: { engine: 'postgres', name: null },
				git: { repo: null, branch: 'main', head: 'abc', subject: 'x' }
			})
		);
		expect(bare.db).toBeNull();
		expect(bare.repo).toBeNull();
		expect(placeholders(app()).db).toBeNull();
	});

	it('translates the inventory kind into the word new-site.sh speaks', () => {
		expect(placeholders(app({ kind: 'mono' })).site_type).toBe('turbo');
		expect(placeholders(app({ kind: 'node' })).site_type).toBe('node');
		// everything else, 'next' and 'other' included, is the next shape
		expect(placeholders(app({ kind: 'next' })).site_type).toBe('next');
		expect(placeholders(app({ kind: 'other' })).site_type).toBe('next');
		expect(placeholders(app({ kind: '' })).site_type).toBe('next');
	});

	it('always declares every word of the contract, filled or null', () => {
		// the menu decides visibility from `key in values`, so a missing key and
		// a null one mean different things: null hides the action, absent leaves
		// it to a later schema. an app with nothing on it must still declare all
		const bare = placeholders(app());
		const full = placeholders(shop());
		expect(Object.keys(bare).sort()).toEqual(Object.keys(full).sort());
	});
});

describe('canFill — whether the menu can name this line', () => {
	it('is true when every word the line uses has a value', () => {
		const v = placeholders(shop());
		expect(canFill('pm2 logs {pm2_api} --lines 100', v)).toBe(true);
		expect(canFill('cd {dir} && {pm} install', v)).toBe(true);
	});

	it('is false as soon as one word the contract defines is null', () => {
		const v = placeholders(app({ processes: [proc({ pm2: 'solo' })] }));
		expect(canFill('pm2 logs {pm2_api}', v)).toBe(false);
		// the same line on an app that has the process
		expect(canFill('pm2 logs {pm2_web}', v)).toBe(true);
	});

	it('leaves a word the contract does not define alone — a later schema, not a gap', () => {
		expect(canFill('echo {later_schema} {name}', placeholders(shop()))).toBe(true);
	});

	it('holds for a line with no words at all, and for an unclosed brace', () => {
		const v = placeholders(shop());
		expect(canFill('pm2 list', v)).toBe(true);
		expect(canFill('', v)).toBe(true);
		expect(canFill('open {', v)).toBe(true);
		expect(canFill('open {}', v)).toBe(true);
	});

	it('reads only lowercase words, so {PM2_API} and {pm2-api} are not placeholders', () => {
		// the contract's keys are all [a-z0-9_]; anything else is left to the
		// shell, and cannot hide an action
		const v = placeholders(app());
		expect(canFill('pm2 logs {PM2_API}', v)).toBe(true);
		expect(canFill('pm2 logs {pm2-api}', v)).toBe(true);
		expect(canFill('pm2 logs {pm2 api}', v)).toBe(true);
		expect(canFill('pm2 logs {pm2_api}', v)).toBe(false);
	});

	it('refuses on the first null even when the line repeats or mixes words', () => {
		const v = placeholders(app({ site: site() }));
		expect(canFill('{domain} {domain}', v)).toBe(true);
		expect(canFill('{domain} {pm2_web} {domain}', v)).toBe(false);
	});
});

describe('appStatus — the dot beside a folder row', () => {
	it('is none when the app runs nothing', () => {
		expect(appStatus(app())).toBe('none');
	});

	it('is online only when every process is', () => {
		expect(
			appStatus(app({ processes: [proc({ status: 'online' }), proc({ status: 'online' })] }))
		).toBe('online');
	});

	it('is trouble for a stopped api beside a running web, not online and not none', () => {
		expect(
			appStatus(
				app({
					processes: [
						proc({ pm2: 'shop-web', status: 'online' }),
						proc({ pm2: 'shop-api', status: 'stopped' })
					]
				})
			)
		).toBe('trouble');
	});

	it('is trouble for every status that is not the word online', () => {
		for (const status of ['stopped', 'errored', 'launching', 'ONLINE', '', null])
			expect(appStatus(app({ processes: [proc({ status })] })), String(status)).toBe(
				'trouble'
			);
	});
});

describe('prefillValues — the values a form opens with', () => {
	it('fills each field from the placeholder its prefill names', () => {
		const a = action([
			field({ name: 'app', prefill: '{name}' }),
			field({ name: 'domain', prefill: '{domain}' }),
			field({ name: 'port', prefill: '{web_port}' })
		]);
		expect(prefillValues(a, shop())).toEqual({
			app: 'shop',
			domain: 'shop.example.com',
			port: '3008'
		});
	});

	it('accepts a prefill written with or without its braces', () => {
		const a = action([
			field({ name: 'a', prefill: '{name}' }),
			field({ name: 'b', prefill: 'name' })
		]);
		const out = prefillValues(a, shop());
		expect(out.b).toBe(out.a);
	});

	it('falls back to the field default when the app lacks that value', () => {
		const a = action([field({ name: 'type', prefill: '{pm2_api}', default: 'next' })]);
		// no processes, so {pm2_api} is null
		expect(prefillValues(a, app()).type).toBe('next');
	});

	it('falls back to the default for every field when there is no app row at all', () => {
		const a = action([
			field({ name: 'type', prefill: '{site_type}', default: 'next' }),
			field({ name: 'port', prefill: '{web_port}' })
		]);
		expect(prefillValues(a, undefined)).toEqual({ type: 'next', port: '' });
	});

	it('gives a field with neither prefill nor default the empty string, never undefined', () => {
		const a = action([field({ name: 'note' })]);
		const out = prefillValues(a, shop());
		expect(out.note).toBe('');
		expect('note' in out).toBe(true);
	});

	it('falls back to the default when the prefill names a word the contract has not got', () => {
		const a = action([field({ name: 'x', prefill: '{later_schema}', default: 'd' })]);
		expect(prefillValues(a, shop()).x).toBe('d');
	});

	it('treats an empty placeholder value as absent and reaches for the default', () => {
		// `||`, not `??`: an app whose pm is '' opens the form on the default.
		// nothing in the contract fills a word with '' today — placeholders()
		// already maps '' to null — so this pins the rule, not a live case
		const a = action([field({ name: 'pm', prefill: '{pm}', default: 'npm' })]);
		expect(prefillValues(a, app({ pm: '' })).pm).toBe('npm');
	});

	it('keys the result by field name and covers every declared field once', () => {
		const a = action([
			field({ name: 'a' }),
			field({ name: 'b' }),
			field({ name: 'c' })
		]);
		expect(Object.keys(prefillValues(a, shop()))).toEqual(['a', 'b', 'c']);
	});
});

describe('whenHolds — a field that shows only for some shapes', () => {
	it('holds when the field declares no clause', () => {
		expect(whenHolds(null, {})).toBe(true);
		expect(whenHolds('', {})).toBe(true);
	});

	it('compares the value exactly for a k=v clause', () => {
		expect(whenHolds('type=turbo', { type: 'turbo' })).toBe(true);
		expect(whenHolds('type=turbo', { type: 'next' })).toBe(false);
		// case-sensitive, and no prefix match
		expect(whenHolds('type=turbo', { type: 'Turbo' })).toBe(false);
		expect(whenHolds('type=turbo', { type: 'turborepo' })).toBe(false);
	});

	it('reads a bare key as "this bool is on"', () => {
		expect(whenHolds('ssl', { ssl: 'true' })).toBe(true);
		expect(whenHolds('ssl', { ssl: 'false' })).toBe(false);
		// only the word 'true' counts — not '1', not 'yes'
		expect(whenHolds('ssl', { ssl: '1' })).toBe(false);
	});

	it('is false when the clause names a field the form does not hold', () => {
		expect(whenHolds('type=turbo', {})).toBe(false);
		expect(whenHolds('ssl', {})).toBe(false);
	});

	it('trims space around both sides of the clause', () => {
		expect(whenHolds(' type = turbo ', { type: 'turbo' })).toBe(true);
		expect(whenHolds(' ssl ', { ssl: 'true' })).toBe(true);
	});

	it('requires the empty string for a clause written k=', () => {
		expect(whenHolds('type=', { type: '' })).toBe(true);
		expect(whenHolds('type=', { type: 'next' })).toBe(false);
		// and an absent field is undefined, which is not ''
		expect(whenHolds('type=', {})).toBe(false);
	});

	it('splits on the first = only, so the value keeps every later =', () => {
		// server_apps.rs:565 uses split_once('='), so `k=a=b` asks for 'a=b'.
		// the mirror must ask the same thing — no contract value carries an '='
		// today, so this pins the mirror, not a shipping behaviour
		expect(whenHolds('k=a=b', { k: 'a=b' })).toBe(true);
		expect(whenHolds('k=a=b', { k: 'a' })).toBe(false);
		// the two boundaries split_once draws, unchanged by the split rule:
		// no '=' is None — the bare-key bool clause
		expect(whenHolds('k', { k: 'true' })).toBe(true);
		expect(whenHolds('k', { k: '' })).toBe(false);
		// a trailing '=' is Some(('k', '')) — the empty value, not a bare key
		expect(whenHolds('k=', { k: '' })).toBe(true);
		expect(whenHolds('k=', { k: 'true' })).toBe(false);
		// and the first '=' wins however many follow it
		expect(whenHolds('k=a=b=c', { k: 'a=b=c' })).toBe(true);
		expect(whenHolds(' k = a=b ', { k: 'a=b' })).toBe(true);
	});
});

describe('fillLabel — a menu entry that names what it will do', () => {
	it('fills each word from the values', () => {
		const v = placeholders(shop());
		expect(fillLabel('Logs · {pm2_api}', v)).toBe('Logs · shop-api');
		expect(fillLabel('{name} → {domain}', v)).toBe('shop → shop.example.com');
	});

	it('leaves a null value as its own brace text, which is why canFill runs on the label too', () => {
		const v = placeholders(app());
		// the label the menu must NOT draw — and canFill is what stops it
		expect(fillLabel('Logs · {pm2_api}', v)).toBe('Logs · {pm2_api}');
		expect(canFill('Logs · {pm2_api}', v)).toBe(false);
	});

	it('leaves a word the contract does not define alone', () => {
		expect(fillLabel('{later_schema} · {name}', placeholders(shop()))).toBe(
			'{later_schema} · shop'
		);
	});

	it('touches nothing that is not a lowercase brace word', () => {
		const v = placeholders(shop());
		expect(fillLabel('Logs {NAME} {na-me} {}', v)).toBe('Logs {NAME} {na-me} {}');
		expect(fillLabel('no words here', v)).toBe('no words here');
		expect(fillLabel('', v)).toBe('');
	});

	it('fills every occurrence, not just the first', () => {
		expect(fillLabel('{name}/{name}', placeholders(shop()))).toBe('shop/shop');
	});
});
