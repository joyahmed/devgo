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

// the search boxes' sizing, written once for all five call sites. one
// SearchBox drawn five times was five different sizes, because the size
// was never the component's: the project box carried a 12rem floor, the
// github and server boxes carried none, and the two boxes in the lane
// headings were a third and a fourth number again. joy compared the
// three across windows, macos and ubuntu and said they were not the same
// boxes; they were not.
//
// the floor is what a box without one loses. SearchBox's own container
// query drops the summon chip (ctrl+k / ctrl+g / ctrl+h) under its
// lane's GATE — 18.5rem of content over projects and github, 20rem over
// servers, whose placeholder is 24px longer —
// and a little under that the placeholder stops saying what the box
// searches: "Search GitHub repos…" was already clipping with 156px of
// input, and the github box measured 215px — 142px of input — in the
// 450px lane column three lanes get at 1400. 12rem also has to be the
// floor and
// not more, because a floor a grid child cannot honour overflows the
// column instead of shrinking: the tightest column that holds a box in
// the command row is 450.67px (three lanes at 1400), the github controls
// take 223.6 of it and leave 215, so 13rem is the ceiling and 12rem is
// the number the project box already carried. do not take it off to let
// a lane shrink: a lane shrinking is the thing it is here for
export const searchBoxRow = 'flex-1 min-w-[12rem]';

// the same box in a lane heading, where it shares its line with the
// lane's label, its count and its controls instead of with a column. a
// share of the heading over the same floor, so the two forms of one
// lane's box are the same box. 22rem and not 20: the chip's query is
// asked of the box's CONTENT box, which is 10px narrower than the box
// itself (a 1px border each side and the 2 of padding the chips sit in),
// so a box has to be 306px wide (github, projects) or 330px (servers)
// before its key shows, and 22rem = 352 clears both. capped at 20rem
// the box in the heading would be the one that never shows its key while
// the same box in the command row shows it — which is what it was: 320px
// over github, 280 over servers, neither ever showing one
export const searchBoxHeadingSlot = 'w-[min(22rem,45%)] min-w-[12rem]';

// a heading is a line of text, so the box in one is set a step smaller
// and pulled back to the line's height
export const searchBoxHeading = '-my-1.5 [&_input]:py-1 [&_input]:text-13';

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

// a picker row: already there and inert, ticked, or plain
export const pickTone = (added: boolean, on: boolean) =>
	added
		? 'border-border opacity-60 cursor-default'
		: on
			? 'border-accent cursor-pointer'
			: 'border-border cursor-pointer hover:border-border-strong';

// a file system's hue, the one the lane heading, the card's edges, the
// pinned rows' cell and the title bar's chips share. fixed hues, chosen
// by hue angle and not the accent: wsl and the machine's own disk are two
// real file systems, and one in the accent beside one in grey read as one
// real and one greyed out. sky and orange are 169 degrees apart, which is
// what survives being small; the 200 shades passed every ratio and still
// read as the same near-white. a share is fuchsia, 88 degrees from both,
// so the warning is never mistaken for the ordinary cases. the gate
// checks every entry on every surface of every palette, and the gaps
const FS_TONE: Record<string, string> = {
	WSL: 'text-orange-300',
	Windows: 'text-sky-300',
	Mac: 'text-sky-300',
	Linux: 'text-sky-300',
	Network: 'text-fuchsia-300'
};

export const fsTone = (fs: string) => FS_TONE[fs] ?? 'text-text-muted';

// the card's two leading edges in the file system's hue, the one fsTone
// uses: the lane says what it is at a glance, and selection stays the
// row's ground and its name
const EDGE: Record<string, string> = {
	WSL: 'border-t-orange-300/60 border-l-orange-300/60',
	Windows: 'border-t-sky-300/60 border-l-sky-300/60',
	Mac: 'border-t-sky-300/60 border-l-sky-300/60',
	Linux: 'border-t-sky-300/60 border-l-sky-300/60',
	Network: 'border-t-fuchsia-300/60 border-l-fuchsia-300/60'
};

export const fsEdge = (fs: string) =>
	EDGE[fs] ?? 'border-t-text-muted/40 border-l-text-muted/40';
