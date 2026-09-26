import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProjectTree from './ProjectTree';

// the tree reaches core through uiLog on the rows under it. one stub, the
// way every other component test does it
vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve() }));

afterEach(cleanup);

const server = (id: string, name: string): Server => ({
	id,
	name,
	alias: null,
	host: `${name}.example`,
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

const ALPHA = server('s-alpha', 'alpha');
const BETA = server('s-beta', 'beta');
const ALL = [ALPHA, BETA];

// what useServers hands the tree, narrowed to the parts this asks about:
// the query, and the servers it leaves. `visible` is derived from the
// query here exactly as the hook derives it — by name — because the whole
// point of these cases is what the tree does when the cursor's row is NOT
// in that list
const serversState = (query: string, isOpen: boolean): ServersState => {
	const q = query.trim().toLowerCase();
	return {
		servers: ALL,
		hasSsh: true,
		isOpen,
		toggleOpen: () => {},
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
		toggleExpanded: () => {},
		listFolders: async () => ({}) as ServerListing,
		query,
		setQuery: () => {},
		openDirs: new Set<string>(),
		loadingDirs: new Set<string>(),
		toggleDir: () => {},
		listDir: async () => [],
		foldedRoots: new Set<string>(),
		toggleRoot: () => {},
		showAllIn: new Set<string>(),
		toggleShowAll: () => {},
		visible: ALL.filter(s => !q || s.name.includes(q)).map(s => ({
			server: s,
			open: false,
			groups: []
		}))
	};
};

// the box is controlled by the hook in the app, so a test that types has
// to supply that state — the same reason SearchBox.test.tsx has a harness.
// everything else the tree needs is a stub: no projects, no github, one
// lane on screen
const Harness = ({
	onServerOpen,
	initial = '',
	isOpen = true
}: {
	onServerOpen: (s: Server) => void;
	initial?: string;
	isOpen?: boolean;
}) => {
	const [query, setQuery] = useState(initial);
	const servers = { ...serversState(query, isOpen), setQuery };
	return (
		<ProjectTree
			{...{
				projects: [],
				selected: null,
				onSelect: () => {},
				onDoubleClick: () => {},
				onLaunch: () => {},
				query: '',
				servers,
				onServerOpen
			}}
		/>
	);
};

const box = () => screen.getByPlaceholderText('Search servers & folders…');

// the bug: the ENTER chip is up on the servers box for any text at all —
// the box derives it from its own value and must not be told otherwise —
// while openServerRow returned false unless a row on screen matched the
// cursor. three ordinary states have no such row, and in all three the
// key did nothing at all. the github box next door never had this: it
// falls back to its first match, and now so does this one
describe('ProjectTree — Enter in the servers box always acts', () => {
	it('opens the first match when no row was ever clicked', async () => {
		const user = userEvent.setup();
		const onServerOpen = vi.fn();
		render(<Harness onServerOpen={onServerOpen} />);

		// nothing has set a cursor: selectServer/selectFolder are the only
		// writers and neither has run
		await user.type(box(), 'beta');
		await user.keyboard('{Enter}');

		expect(onServerOpen).toHaveBeenCalledTimes(1);
		expect(onServerOpen.mock.calls[0][0].id).toBe(BETA.id);
	});

	it('opens the first match when the query filtered the cursor away', async () => {
		const user = userEvent.setup();
		const onServerOpen = vi.fn();
		render(<Harness onServerOpen={onServerOpen} />);

		// alpha under the cursor, then a query that leaves only beta: the
		// cursor survives the filter, its row does not
		await user.click(screen.getByText('alpha'));
		await user.type(box(), 'beta');
		expect(screen.queryByText('alpha')).toBeNull();
		await user.keyboard('{Enter}');

		expect(onServerOpen).toHaveBeenCalledTimes(1);
		expect(onServerOpen.mock.calls[0][0].id).toBe(BETA.id);
	});

	// a collapsed lane renders its heading — and the box in it — while the
	// tree pushes no server rows at all, so the lookup had nothing to find
	// even with a cursor set
	it('opens the first match while the lane is collapsed', async () => {
		const user = userEvent.setup();
		const onServerOpen = vi.fn();
		render(<Harness onServerOpen={onServerOpen} isOpen={false} />);

		await user.type(box(), 'beta');
		await user.keyboard('{Enter}');

		expect(onServerOpen).toHaveBeenCalledTimes(1);
		expect(onServerOpen.mock.calls[0][0].id).toBe(BETA.id);
	});

	// the working path, which the fallback must not eat: a row under the
	// cursor still wins, even when it is not the first one on screen
	it('opens the row under the cursor rather than the first match', async () => {
		const user = userEvent.setup();
		const onServerOpen = vi.fn();
		render(<Harness onServerOpen={onServerOpen} />);

		await user.click(screen.getByText('beta'));
		await user.type(box(), 'a');
		await user.keyboard('{Enter}');

		expect(onServerOpen).toHaveBeenCalledTimes(1);
		expect(onServerOpen.mock.calls[0][0].id).toBe(BETA.id);
	});
});
