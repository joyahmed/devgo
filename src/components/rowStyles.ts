// the column grid every row in the table shares. it lived inside
// ProjectTree until a second kind of row needed it; one place, so the
// github rows can never drift from the project rows on columns

// the last column carries a workspace's count or a row's meta (badges,
// branch, hint, star) so it is sized for the meta and the count
// right-aligns in it
export const col =
	'grid grid-cols-[1fr_1fr_minmax(80px,0.4fr)_minmax(150px,0.9fr)] items-center gap-x-3 text-15';

// a group is a card on the surface recipe every drawer and menu uses,
// at half alpha so the transparency knob still shows through it. its hue
// goes on the two leading edges, the way a folder tab shows its colour,
// and runs into nothing. shrink-0: a card is a flex child of the scroller,
// and without it a full list shrank every card and clipped its rows
// instead of scrolling
export const card =
	'shrink-0 rounded-panel border border-border border-t-2 border-l-2 bg-bg-secondary/50 overflow-hidden';

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
// uses: the group says what it is at a glance, and selection stays the
// row's ground and its name
const EDGE: Record<string, string> = {
	WSL: 'border-t-accent/50 border-l-accent/50',
	Network: 'border-t-amber-400/50 border-l-amber-400/50'
};

export const fsEdge = (fs: string) =>
	EDGE[fs] ?? 'border-t-text-muted/40 border-l-text-muted/40';
