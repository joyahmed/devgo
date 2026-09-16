// the class strings every lane row shares. they lived inside ProjectTree
// until a second kind of lane needed them; one place, so the github and
// server rows can never drift from the project rows on height, text size
// or the name's share

// no padding and no margin here: the indent lives inside the box, as
// left padding against the guide rule. no cursor either: the name is the
// click target on a row, headers add their own
export const row = 'select-none transition-colors';
export const rowInner = 'w-full flex items-center gap-4 text-15';
export const rowFlat = `${rowInner} px-4`;
export const rowIndented = `${rowInner} pl-10 pr-4 border-l`;

// 34% of a lane, not of the window: a lane is about half as wide, and a
// name that still gets a third of it leaves the meta within an eye
// movement instead of a screen away
export const nameCell =
	'font-medium font-mono truncate basis-[34%] min-w-[12rem] shrink-0';

// zebra on the rows under a heading, at /30 so it reads as a texture and
// not as stripes
export const zebra = (i: number) => (i % 2 ? 'bg-bg-secondary/30' : '');

// the sticky lane heading: the one label that replaces a per-row cell
export const laneHeader =
	'sticky top-0 z-10 bg-bg-secondary flex items-baseline gap-3 px-4 py-2 border-b border-border';

// the lane breakpoints, written once so the command row above the lanes
// lines up with them. every lane is one equal column (joy: "i should not
// let one column stretch to two columns space. that way things will be
// in symmetry"): four across from 1900, four lanes between 1400 and 1899
// fold to two rows of two, three or two sit side by side from 1400,
// below 1400 everything stacks
export const WIDE_QUERY = '(min-width: 1900px)';
export const MID_QUERY = '(min-width: 1400px)';

const GRID: Record<number, string> = {
	1: 'grid grid-cols-1',
	2: 'grid grid-cols-1 min-[1400px]:grid-cols-2',
	3: 'grid grid-cols-1 min-[1400px]:grid-cols-3',
	4: 'grid grid-cols-1 min-[1400px]:grid-cols-2 min-[1900px]:grid-cols-4'
};

export const laneGrid = (columns: number) =>
	GRID[Math.min(columns, 4)] ?? '';

// a lane is a card on the surface recipe every drawer and menu uses, at
// half alpha so the transparency knob still shows through it. its hue
// goes on the two leading edges, the way a folder tab shows its colour.
// from 1400 the card is bounded by its grid row and scrolls inside;
// below that the lanes stack in one scroller. shrink-0: a card in a flex
// column shrank and clipped its rows instead of scrolling
export const card =
	'shrink-0 min-w-0 min-[1400px]:min-h-0 flex flex-col rounded-panel border border-border border-t-2 border-l-2 bg-bg-secondary/50 overflow-hidden';

// the card's body: its own scroller from 1400, the window's below
export const laneBody =
	'min-[1400px]:flex-1 min-[1400px]:min-h-0 min-[1400px]:overflow-y-auto';

// the four-column grid the table rows shared; gone with the last table row
export const col =
	'grid grid-cols-[1fr_1fr_minmax(80px,0.4fr)_minmax(150px,0.9fr)] items-center gap-x-3 text-15';

// a picker row: already there and inert, ticked, or plain
export const pickTone = (added: boolean, on: boolean) =>
	added
		? 'border-border opacity-60 cursor-default'
		: on
			? 'border-accent cursor-pointer'
			: 'border-border cursor-pointer hover:border-border-strong';

// a file system's hue, the one the rows' cell, the card's edges and the
// title bar's chips share: wsl in the accent, a share in amber, the
// machine's own disk muted, whatever it is called
const FS_TONE: Record<string, string> = {
	WSL: 'text-accent',
	Network: 'text-amber-400'
};

export const fsTone = (fs: string) => FS_TONE[fs] ?? 'text-text-muted';

// the card's two leading edges in the file system's hue, the one fsTone
// uses: the lane says what it is at a glance, and selection stays the
// row's ground and its name
const EDGE: Record<string, string> = {
	WSL: 'border-t-accent/50 border-l-accent/50',
	Network: 'border-t-amber-400/50 border-l-amber-400/50'
};

export const fsEdge = (fs: string) =>
	EDGE[fs] ?? 'border-t-text-muted/40 border-l-text-muted/40';
