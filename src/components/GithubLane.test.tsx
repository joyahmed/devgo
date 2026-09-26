import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GithubLane from './GithubLane';

// the lane itself talks to nothing, but the tree under it reaches core
// through uiLog. one stub, the way every other component test does it
vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve() }));

afterEach(cleanup);

// a cache fetched an hour ago under the login `joyahmed`. the lane must
// keep this — a repo list is still worth having with gh signed out — and
// only stop CLAIMING it is current
const cache: GithubCache = {
	fetched_at: Math.floor(Date.now() / 1000) - 3600,
	login: 'joyahmed',
	orgs: [],
	repos: []
};

const state = (status: GhStatus | null): GithubState => ({
	query: '',
	setQuery: () => {},
	payload: {
		cache,
		stale: false,
		refreshing: false,
		orgs: null,
		local: {},
		live_search: false
	},
	status,
	refreshing: false,
	lastError: null,
	available: true,
	isOpen: true,
	toggleOpen: () => {},
	visible: [],
	sections: [],
	cacheMatches: null,
	liveExtras: [],
	searching: false,
	liveOn: false,
	setLiveSearch: async () => {},
	groups: [],
	editGroups: async () => [],
	folded: new Set<string>(),
	toggleGroup: () => {},
	showRecents: true,
	toggleRecents: () => {},
	refresh: () => {},
	reload: () => {},
	setOrgs: async () => {}
});

const lane = (status: GhStatus | null) =>
	render(
		<GithubLane
			{...{
				github: state(status),
				cursor: null,
				onSelect: () => {},
				onOpen: () => {},
				onContextMenu: () => {},
				onShowLocal: () => {},
				onOpenBranches: () => {}
			}}
		/>
	);

const IN: GhStatus = { installed: true, version: '2.97.0', login: 'joyahmed' };
const OUT: GhStatus = { installed: true, version: '2.97.0', login: null };

// the same class of defect as the backups panel's "not asked" vs "no
// off-site copy", and wsl_config_report calling a file it never opened
// healthy: a cached answer presented as a live one. `gh auth logout` and
// the name stayed on the heading, under the words "Logged in as"
describe('GithubLane — the login on the heading', () => {
	it('names the live login when gh has one', () => {
		lane(IN);
		const chip = screen.getByTitle('Logged in as');
		expect(chip.textContent).toBe('joyahmed');
	});

	it('never says "Logged in as" once gh is signed out', () => {
		lane(OUT);
		expect(screen.queryByTitle('Logged in as')).toBeNull();
	});

	// the name is kept, because the cached list beside it is the user's own
	// and saying whose it is helps. it is the tense that changes
	it('marks the cached name as stale rather than dropping it', () => {
		lane(OUT);
		const chip = screen.getByText(/joyahmed/);
		expect(chip.textContent).toContain('signed out');
		expect(chip.getAttribute('title')).toContain('gh is signed out');
		expect(chip.getAttribute('title')).toContain('gh auth login');
	});

	// nothing about the cache itself may change: the repos, the org list
	// and the fetch time are as good signed out as signed in
	it('keeps the cached list and its age', () => {
		lane(OUT);
		expect(screen.getByText(/repos? · updated/)).not.toBeNull();
	});

	// before gh has answered at all, the cached name is the only answer
	// there is and nothing contradicts it — that is not a false claim
	it('shows the cached name plainly while gh has not answered yet', () => {
		lane(null);
		expect(screen.getByTitle('Logged in as').textContent).toBe('joyahmed');
	});
});
