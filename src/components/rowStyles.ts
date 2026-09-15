// the column grid every row in the table shares. it lived inside
// ProjectTree until a second kind of row needed it; one place, so the
// github rows can never drift from the project rows on columns

// the last column carries a workspace's count or a row's meta (badges,
// branch, hint, star) so it is sized for the meta and the count
// right-aligns in it
export const col =
	'grid grid-cols-[1fr_1fr_minmax(80px,0.4fr)_minmax(150px,0.9fr)] items-center gap-x-3 text-sm';

// a picker row: already there and inert, ticked, or plain
export const pickTone = (added: boolean, on: boolean) =>
	added
		? 'border-border opacity-60 cursor-default'
		: on
			? 'border-accent cursor-pointer'
			: 'border-border cursor-pointer hover:border-border-strong';
