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

// the selected row's second cue (rowStyles.ts `selectedCue`): a
// border-strong-coloured right edge, next to the fill, so a theme whose
// fill is faint (Pure Black, 1.35:1 against its ground) still marks
// "selected" with something check-contrast.mjs holds to a real 3:1+.
// pinned rows already carry a left-edge cue (border-l-accent/60) — the
// point of putting the new one on the RIGHT is that a row which is both
// selected and pinned must show both, not one swallowing the other
describe('ProjectTree — the selected row draws its own edge, not just a fill', () => {
	const project = (name: string): Project => ({
		name,
		full_path: `/w/${name}`,
		workspace: 'W',
		file_system: 'Windows'
	});

	const alpha = project('alpha-proj');
	const beta = project('beta-proj');

	// the outer row div (bg-bg-selected, the new cue) is the name's
	// grandparent: name -> rowIndented (pinned's border-l) -> the row.
	// no jest-dom in this suite (test-setup.ts registers only RTL's
	// cleanup), so classes are read off className directly
	const rowOf = (label: string) => screen.getByText(label).parentElement!.parentElement!;
	const indentedOf = (label: string) => screen.getByText(label).parentElement!;
	const classesOf = (el: HTMLElement) => el.className.split(/\s+/);

	it('gives an ordinary selected row the right-edge cue', () => {
		render(
			<ProjectTree
				{...{
					projects: [alpha, beta],
					selected: beta,
					onSelect: () => {},
					onDoubleClick: () => {},
					onLaunch: () => {},
					query: ''
				}}
			/>
		);

		const rowClasses = classesOf(rowOf('beta-proj'));
		expect(rowClasses).toContain('border-r-2');
		expect(rowClasses).toContain('border-r-border-strong');
		// not pinned: the left edge stays the quiet divider, not the accent
		const indentedClasses = classesOf(indentedOf('beta-proj'));
		expect(indentedClasses).toContain('border-l-border');
		expect(indentedClasses).not.toContain('border-l-accent/60');
	});

	it('keeps the pinned cue on a pinned, unselected row — and nothing on the right', () => {
		render(
			<ProjectTree
				{...{
					projects: [alpha, beta],
					selected: null,
					onSelect: () => {},
					onDoubleClick: () => {},
					onLaunch: () => {},
					query: '',
					pinnedProjects: [alpha]
				}}
			/>
		);

		expect(classesOf(indentedOf('alpha-proj'))).toContain('border-l-accent/60');
		expect(classesOf(rowOf('alpha-proj'))).not.toContain('border-r-border-strong');
	});

	it('shows BOTH cues on a row that is selected and pinned at once', () => {
		render(
			<ProjectTree
				{...{
					projects: [alpha, beta],
					selected: alpha,
					onSelect: () => {},
					onDoubleClick: () => {},
					onLaunch: () => {},
					query: '',
					pinnedProjects: [alpha]
				}}
			/>
		);

		// pinned's left edge survives selection...
		expect(classesOf(indentedOf('alpha-proj'))).toContain('border-l-accent/60');
		// ...and selection's right edge is not swallowed by it
		const rowClasses = classesOf(rowOf('alpha-proj'));
		expect(rowClasses).toContain('border-r-2');
		expect(rowClasses).toContain('border-r-border-strong');
	});
});
