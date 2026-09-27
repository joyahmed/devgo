import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from 'vitest';
import CommandPalette from './CommandPalette';

// no invoke stub here, and not an omission: the palette's import graph —
// scoreCommand, Button, Kbd — reaches @tauri-apps/api nowhere. every ask it
// makes is a function it was handed (`onClose`, and each command's `run`), so
// those spies ARE the whole wire. what it DOES touch is localStorage, which is
// a global shared by the whole run, so it is cleared on BOTH sides of every
// test: before, so a test never inherits somebody's recents; after, so it never
// leaves any.
//
// the palette is content only — the drawer that mounts it owns the surface, the
// backdrop and the escape key — so nothing here asserts on either of those.

// CommandPalette.tsx:51 scrolls the cursor row into view on every move, and
// jsdom implements no scrolling at all: `Element.prototype.scrollIntoView` does
// not exist, so the unstubbed call is a TypeError on mount. the stub is also
// the only honest way to observe "the cursor is kept in view" in a DOM with no
// layout — the call is asserted, never a position.
const scrollIntoView = vi.fn();
let hadScrollIntoView = false;
beforeAll(() => {
	hadScrollIntoView = 'scrollIntoView' in Element.prototype;
	Element.prototype.scrollIntoView = scrollIntoView;
});
afterAll(() => {
	if (!hadScrollIntoView) {
		delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
	}
});

// ⚠️ braces, not a concise body. vitest reads a function RETURNED from a
// beforeEach as that test's teardown hook; localStorage.clear() happens to
// return undefined so this one is safe either way, but the shape is the house
// rule because mockReset() does not.
beforeEach(() => {
	localStorage.clear();
	scrollIntoView.mockClear();
});
afterEach(() => {
	cleanup();
	localStorage.clear();
});

// id-shaped literals live in named consts: src-tauri/src/commands.rs walks this
// directory and refuses a frontend file that spells an id inline next to an
// id-shaped key.
const RECENT_KEY = 'devgo.recentCommands';
const REFRESH_ID = 'refresh';
const SETTINGS_ID = 'settings';
const ROOTS_ID = 'roots';
const CLONE_ID = 'clone';
const TERMINAL_ID = 'open.terminal';
const EDITOR_ID = 'open.editor';

const CLOSE = 'close';
const RUN = 'run:';

// what the palette persists, read back the way the component reads it
const stored = (): unknown => JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null');
const seed = (ids: string[]) =>
	localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
// filler ids for the cap tests. they are NOT commands on the deck, which is
// exactly a real recents list a release later: pushRecent works on the stored
// array and does not care whether an id still resolves, and the rows for these
// are dropped from the Recent section — the behaviour test 'leaves out a recent
// whose command is gone' pins.
const PAD = 'pad-';
const pads = (n: number) => Array.from({ length: n }, (_, i) => `${PAD}${i}`);

// the deck every test mounts unless it says otherwise. plain rows — no subtitle
// and no key chip — so a button's accessible name IS its title and the order
// assertions read as the list a person sees. declaration order is the order the
// palette shows with an empty box and no recents.
//
// titles are picked so `conf` scores them apart by hand (see the ranking test)
// and so `vs` matches the disabled row alone.
const deck = () => {
	const order: string[] = [];
	const runs: Record<string, ReturnType<typeof vi.fn>> = {};
	// what was already on disk at the moment a command ran
	let recentsAtRun: unknown = 'the command never ran';

	const cmd = (
		id: string,
		title: string,
		over: Partial<PaletteCommand> = {}
	): PaletteCommand => {
		const run = vi.fn(() => {
			order.push(`${RUN}${id}`);
			recentsAtRun = stored();
		});
		runs[id] = run;
		return { id, title, run, ...over };
	};

	const commands: PaletteCommand[] = [
		cmd(REFRESH_ID, 'Refresh projects', { keywords: ['rescan', 'reload'] }),
		cmd(SETTINGS_ID, 'Open Settings', { keywords: ['preferences', 'config'] }),
		cmd(ROOTS_ID, 'Configure roots'),
		cmd(CLONE_ID, 'Clone from GitHub'),
		cmd(TERMINAL_ID, 'Open terminal'),
		cmd(EDITOR_ID, 'Open in VS Code', { disabled: true })
	];

	return { commands, runs, order, recentsAtRun: () => recentsAtRun };
};

const mount = (commands?: PaletteCommand[]) => {
	const d = deck();
	const onClose = vi.fn(() => {
		d.order.push(CLOSE);
	});
	render(<CommandPalette commands={commands ?? d.commands} onClose={onClose} />);
	return { ...d, onClose };
};

const box = () => screen.getByPlaceholderText('Type a command…');
const rows = () => screen.getAllByRole('button') as HTMLButtonElement[];
const titles = () => rows().map(b => b.textContent);
// the cursor says where it is with aria-current, not with colour alone, so that
// is what is read — never a class and never a position
const cursor = () =>
	rows().find(b => b.getAttribute('aria-current') === 'page')?.textContent;

const ALL = [
	'Refresh projects',
	'Open Settings',
	'Configure roots',
	'Clone from GitHub',
	'Open terminal',
	'Open in VS Code'
];

describe('CommandPalette — what the empty box shows', () => {
	it('lists every command in the order it was handed them, cursor on the first', () => {
		mount();
		expect(titles()).toEqual(ALL);
		expect(cursor()).toBe('Refresh projects');
		// no recents on disk, so neither divider is drawn — a lone "All commands"
		// heading over the whole list would be noise
		expect(screen.queryByText('Recent')).toBeNull();
		expect(screen.queryByText('All commands')).toBeNull();
	});

	it('puts the recents first, newest first, and never twice', () => {
		seed([TERMINAL_ID, CLONE_ID]);
		mount();

		expect(titles()).toEqual([
			'Open terminal',
			'Clone from GitHub',
			'Refresh projects',
			'Open Settings',
			'Configure roots',
			'Open in VS Code'
		]);
		// the headings straddle the seam: "All commands" shares its wrapper with
		// the first row that is not a recent, which is what "the divider sits
		// above that row" means in a DOM with no layout
		expect(
			screen.getByText('Recent').parentElement?.querySelector('button')?.textContent
		).toBe('Open terminal');
		expect(
			screen
				.getByText('All commands')
				.parentElement?.querySelector('button')?.textContent
		).toBe('Refresh projects');
	});

	it('leaves out a recent whose command is gone or is disabled', () => {
		// EDITOR_ID is on the deck but disabled; the pad id is not on the deck at
		// all — a command removed in a later release. neither can be run from the
		// Recent section, so neither belongs in it
		seed([`${PAD}gone`, EDITOR_ID]);
		mount();

		expect(titles()).toEqual(ALL);
		// nothing survived the filter, so recentCount is 0 and there is no seam
		expect(screen.queryByText('Recent')).toBeNull();
		expect(screen.queryByText('All commands')).toBeNull();
	});

	it('survives a stored value that is not a list of ids', () => {
		localStorage.setItem(RECENT_KEY, '{not json');
		mount();
		expect(titles()).toEqual(ALL);

		cleanup();
		// valid JSON, wrong shape — the guard is Array.isArray, not try/catch
		localStorage.setItem(RECENT_KEY, '"open.terminal"');
		mount();
		expect(titles()).toEqual(ALL);
		expect(screen.queryByText('Recent')).toBeNull();
	});

	it('treats a box holding only spaces as an empty box', async () => {
		// the gate is `query.trim()`, not `query`, and the difference is visible:
		// a space is what you get from a fat thumb or a paste, and scoring it
		// would be scoring the empty string against every title. the recents have
		// to come back instead, seam and all
		seed([TERMINAL_ID, CLONE_ID]);
		mount();
		const user = userEvent.setup();
		await user.type(box(), '   ');

		// no jest-dom in this suite, so the value is read off the node
		expect((box() as HTMLInputElement).value).toBe('   ');
		expect(titles()).toEqual([
			'Open terminal',
			'Clone from GitHub',
			'Refresh projects',
			'Open Settings',
			'Configure roots',
			'Open in VS Code'
		]);
		expect(screen.getByText('Recent')).toBeTruthy();
		expect(screen.getByText('All commands')).toBeTruthy();
	});

	it('draws no second heading when every row is already a recent', () => {
		// heading() finds the seam by index — `i === recentCount` — so when the
		// recents ARE the whole list no index can equal it and "All commands"
		// is never drawn. that is the right answer and not a miss: an empty
		// section header under the last recent would be a promise of rows that
		// do not exist
		seed([TERMINAL_ID, REFRESH_ID]);
		mount([
			{ id: REFRESH_ID, title: 'Refresh projects', run: vi.fn() },
			{ id: TERMINAL_ID, title: 'Open terminal', run: vi.fn() }
		]);

		expect(titles()).toEqual(['Open terminal', 'Refresh projects']);
		expect(screen.getByText('Recent')).toBeTruthy();
		expect(screen.queryByText('All commands')).toBeNull();
	});
});

describe('CommandPalette — what typing does to the list', () => {
	it('ranks by score, best first, and drops what does not match', async () => {
		seed([TERMINAL_ID]);
		mount();
		const user = userEvent.setup();
		await user.type(box(), 'conf');

		// scored by hand from src/palette.ts, and the three are deliberately
		// apart rather than tied:
		//   'configure roots'  c+o+n+f contiguous from a word start  → 20
		//   keyword 'config'   the SAME hit, weighted ×0.9           → 18
		//   'clone from github' c, o, n, then f at a word start      → 14
		// the middle row is the docstring's promise made observable: an alias hit
		// is worth a hair less than the identical hit on a title, so the title
		// floats above it while the alias still beats a scattered match
		expect(titles()).toEqual([
			'Configure roots',
			'Open Settings',
			'Clone from GitHub'
		]);
		// a typed query is a search of everything, not of the recents: the seeded
		// recent does not match `conf` and is simply gone
		expect(screen.queryByText('Recent')).toBeNull();
		expect(screen.queryByText('All commands')).toBeNull();
		expect(cursor()).toBe('Configure roots');
	});

	it('says so when nothing matches, and Enter then does nothing', async () => {
		const { onClose, order } = mount();
		const user = userEvent.setup();
		await user.type(box(), 'zzzz{Enter}');

		expect(screen.getByText('No matching commands')).toBeTruthy();
		// queryAll, not the rows() helper: getAllByRole throws on an empty match
		// and "there is no row" is the assertion
		expect(screen.queryAllByRole('button')).toHaveLength(0);
		expect(onClose).not.toHaveBeenCalled();
		expect(order).toEqual([]);
		expect(stored()).toBeNull();
	});
});

describe('CommandPalette — the cursor', () => {
	it('moves with the arrows, clamps at both ends, and is kept in view', async () => {
		mount();
		const user = userEvent.setup();
		// the effect fires once for the mount's own cursor
		expect(scrollIntoView).toHaveBeenCalledTimes(1);

		await user.type(box(), '{ArrowUp}');
		// already on the first row: ArrowUp is a no-op, not a wrap to the end
		expect(cursor()).toBe('Refresh projects');

		await user.type(box(), '{ArrowDown}{ArrowDown}');
		expect(cursor()).toBe('Configure roots');
		expect(scrollIntoView).toHaveBeenCalledTimes(3);
		expect(scrollIntoView.mock.calls[2]).toEqual([{ block: 'nearest' }]);

		// eight downs on a six-row list: it stops on the last row rather than
		// running off the end
		await user.type(box(), '{ArrowDown}'.repeat(8));
		expect(cursor()).toBe('Open in VS Code');

		await user.type(box(), '{ArrowUp}');
		expect(cursor()).toBe('Open terminal');
	});

	it('goes back to the first result whenever the query changes', async () => {
		mount();
		const user = userEvent.setup();
		await user.type(box(), '{ArrowDown}{ArrowDown}');
		expect(cursor()).toBe('Configure roots');

		await user.type(box(), 'o');
		// a cursor left at index 2 of the old list would point at an unrelated row
		// of the new one, or past its end
		expect(cursor()).toBe(titles()[0]);
		expect(cursor()).not.toBe('Configure roots');
	});

	it('follows the pointer, and Enter runs the row the pointer left it on', async () => {
		const { order, onClose } = mount();
		const user = userEvent.setup();
		await user.hover(screen.getByRole('button', { name: 'Clone from GitHub' }));
		expect(cursor()).toBe('Clone from GitHub');

		// one cursor, shared by mouse and keyboard: Enter must run what the last
		// hover pointed at, not what the arrows last chose
		await user.type(box(), '{Enter}');
		expect(order).toEqual([CLOSE, `${RUN}${CLONE_ID}`]);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('comes back from an arrow pressed while nothing matched', async () => {
		// the path this pins: an arrow pressed while the list is EMPTY has no row
		// to move to, and backspacing to a query that does match has to put a
		// usable cursor back on screen, because the only thing a person can do
		// next is press Enter. it holds for two independent reasons — the
		// ArrowDown clamp's floor of 0, and onChange resetting the cursor on
		// every keystroke — and it passed even before the floor existed, which
		// is why the floor has a pin of its own below
		const { order } = mount();
		const user = userEvent.setup();
		await user.type(box(), 'zzzz{ArrowDown}{ArrowDown}');
		expect(screen.getByText('No matching commands')).toBeTruthy();

		// four backspaces, then a query that matches one row
		await user.type(box(), '{Backspace>4/}vs code');
		expect(titles()).toEqual(['Open in VS Code']);
		// the cursor is ON that row, not stranded at a negative index where
		// Enter would silently do nothing
		expect(cursor()).toBe('Open in VS Code');

		// and the row it landed on is the disabled one, so Enter is still a
		// no-op — for the disabled reason, which is the correct one
		await user.type(box(), '{Enter}');
		expect(order).toEqual([]);
	});

	it('never lets ArrowDown leave the cursor at a negative index', async () => {
		// the ArrowDown clamp has a FLOOR as well as a ceiling, because on an
		// empty list the ceiling `list.length - 1` is -1 — an index no row can
		// ever have. onChange hides it (every keystroke resets the cursor to 0),
		// so the only way to SEE the index an arrow left behind is to make the
		// list non-empty without touching the box — which a new `commands` prop
		// does, since react keeps the component's state across it
		const found: PaletteCommand[] = [
			{ id: TERMINAL_ID, title: 'Zzzz terminal', run: vi.fn() }
		];
		const { rerender } = render(<CommandPalette commands={[]} onClose={vi.fn()} />);
		const user = userEvent.setup();
		await user.type(box(), 'zzzz{ArrowDown}{ArrowDown}');
		expect(screen.getByText('No matching commands')).toBeTruthy();

		rerender(<CommandPalette commands={found} onClose={vi.fn()} />);
		// the box still holds `zzzz` and the new row matches it. with the floor
		// the cursor is index 0 and lands on that row; without it the ceiling
		// pins the index at -1 and every further press keeps it there — it never
		// walks deeper negative, because min(i + 1, -1) is -1 from any index — so
		// no row would be current at all
		expect(titles()).toEqual(['Zzzz terminal']);
		expect(cursor()).toBe('Zzzz terminal');
	});
});

describe('CommandPalette — the keys it takes and the keys it leaves alone', () => {
	it('has the box focused on mount, so the first keystroke is a query', () => {
		mount();
		// autoFocus, and it matters: the palette opens on a shortcut with no
		// click anywhere, so a box that is not focused is a palette you cannot
		// type into
		expect(document.activeElement).toBe(box());
	});

	it('swallows the three keys it owns and lets every other key through', async () => {
		// a keydown listener on document sees the event AFTER react's handler has
		// run at the root container, so defaultPrevented reads react's decision.
		// this is the only observable difference between "handled" and "passed
		// on" — and the one that matters, because Escape belongs to the drawer
		// mounting this and a prevented Escape would never reach it
		const seen: Record<string, boolean> = {};
		const spy = (e: KeyboardEvent) => {
			seen[e.key] = e.defaultPrevented;
		};
		document.addEventListener('keydown', spy);
		try {
			mount();
			const user = userEvent.setup();
			// the letter goes in BEFORE Tab: Tab is a real focus move in jsdom, so
			// anything typed after it lands on whatever Tab reached, not the box
			await user.type(box(), '{ArrowDown}{ArrowUp}{Escape}a{Tab}');

			// the palette's own three: prevented, or ArrowUp/ArrowDown would also
			// drag the text caret and Enter could submit an enclosing form
			expect(seen.ArrowDown).toBe(true);
			expect(seen.ArrowUp).toBe(true);

			// not the palette's: Escape is the drawer's close, Tab is the focus
			// cycle, and a letter has to reach the box or nothing can be typed
			expect(seen.Escape).toBe(false);
			expect(seen.Tab).toBe(false);
			expect(seen.a).toBe(false);
			// the letter actually landed
			expect((box() as HTMLInputElement).value).toBe('a');
		} finally {
			document.removeEventListener('keydown', spy);
		}
	});

	it('prevents Enter only when there is a row for it to run', async () => {
		let enterPrevented: boolean | undefined;
		const spy = (e: KeyboardEvent) => {
			if (e.key === 'Enter') enterPrevented = e.defaultPrevented;
		};
		document.addEventListener('keydown', spy);
		try {
			const { order } = mount();
			const user = userEvent.setup();
			await user.type(box(), '{Enter}');

			// Enter is in the key map, so it is prevented before run() is even
			// consulted — the guard against an empty list lives inside run(),
			// not in whether the key is claimed
			expect(enterPrevented).toBe(true);
			expect(order).toEqual([CLOSE, `${RUN}${REFRESH_ID}`]);
		} finally {
			document.removeEventListener('keydown', spy);
		}
	});
});

describe('CommandPalette — running a command', () => {
	it('writes the recent, closes, and only then runs — once each', async () => {
		const { order, onClose, runs, recentsAtRun } = mount();
		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'Open terminal' }));

		// the order is load-bearing, and this is the assertion that pins it: a
		// command that opens a drawer or a menu has to open onto a clean screen,
		// so the palette is gone BEFORE run() is entered
		expect(order).toEqual([CLOSE, `${RUN}${TERMINAL_ID}`]);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(runs[TERMINAL_ID]).toHaveBeenCalledTimes(1);
		// and the recent is already on disk when the command runs, so a command
		// that reopens the palette sees itself at the top
		expect(recentsAtRun()).toEqual([TERMINAL_ID]);
		expect(stored()).toEqual([TERMINAL_ID]);
	});

	it('keeps a disabled command findable but runs nothing and stays open', async () => {
		const { order, onClose } = mount();
		const user = userEvent.setup();
		// `vs` matches the disabled row and nothing else on the deck. disabled
		// means greyed, not hidden: a project action with nothing selected has to
		// stay discoverable
		await user.type(box(), 'vs');
		expect(titles()).toEqual(['Open in VS Code']);
		expect(rows()[0].disabled).toBe(true);

		await user.click(rows()[0]);
		await user.type(box(), '{Enter}');

		// neither door opens it: not the click, and not Enter on the cursor that
		// is sitting on it
		expect(order).toEqual([]);
		expect(onClose).not.toHaveBeenCalled();
		// and nothing unrunnable is remembered as recent
		expect(stored()).toBeNull();
	});

	it('shows a subtitle and a key chip when the command carries them', () => {
		const HINT = 'ALT+ENTER';
		mount([
			{
				id: TERMINAL_ID,
				title: 'Open terminal',
				subtitle: 'devgo, in your terminal',
				hint: HINT,
				run: vi.fn()
			}
		]);

		expect(screen.getByText('devgo, in your terminal')).toBeTruthy();
		// the chip is a <kbd>, so the keys are announced as keys and not as a
		// styled word. the uppercasing is css and is not asserted
		expect(screen.getByText(HINT).tagName).toBe('KBD');
	});
});

describe('CommandPalette — the recents cap of ten', () => {
	it('grows to exactly ten, then drops the oldest to stay there', async () => {
		seed(pads(9));
		const user = userEvent.setup();
		mount();
		await user.click(screen.getByRole('button', { name: 'Open terminal' }));

		// nine plus one is the cap itself: nothing may be lost here
		expect(stored()).toEqual([TERMINAL_ID, ...pads(9)]);
		expect(stored()).toHaveLength(10);

		cleanup();
		mount();
		await user.click(screen.getByRole('button', { name: 'Clone from GitHub' }));

		// eleventh: the newest is first and the OLDEST is the one that goes
		expect(stored()).toEqual([CLONE_ID, TERMINAL_ID, ...pads(8)]);
		expect(stored()).toHaveLength(10);
		expect(stored()).not.toContain(`${PAD}8`);
	});

	it('trims a list that was already longer than the cap', async () => {
		// twelve on disk, e.g. written by a build with a bigger cap. the slice is
		// applied to the result, not to the input, so the very next choice heals
		// the list instead of carrying the overflow forever
		seed(pads(12));
		mount();
		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'Open terminal' }));

		expect(stored()).toEqual([TERMINAL_ID, ...pads(9)]);
		expect(stored()).toHaveLength(10);
	});

	it('moves a command already remembered to the front without duplicating it', async () => {
		seed([`${PAD}0`, TERMINAL_ID, `${PAD}1`]);
		mount();
		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'Open terminal' }));

		expect(stored()).toEqual([TERMINAL_ID, `${PAD}0`, `${PAD}1`]);
		// the length is the whole point: a push that appended instead of moving
		// would spend the cap on one command chosen ten times
		expect(stored()).toHaveLength(3);
	});
});
