import { laneHeader } from './rowStyles';

// the sticky heading every lane card wears: caps survive in exactly one
// place, the lane label, which is what makes it read as a heading over
// the workspace headings under it. a collapsing lane puts its arrow
// first and takes the click on the whole line.
// ⛔ no title here, and do not put one back. it used to say
// Collapse/Expand, and a title is inherited for tooltip purposes, so
// every menu opener in this row — the github and servers heading menus —
// opened underneath a native "Collapse" tooltip, an OS window the
// webview cannot draw over (5ca70d2 logged it as unfixed: title='' on
// the child could not be shown to suppress it in this webview). the ▼/▶
// glyph below is printed by the same condition the title had and says
// open or closed already, so the tooltip was telling the reader what the
// row was showing them anyway
const LaneHeading = ({
	label,
	tone,
	line,
	open,
	onToggle,
	onContextMenu,
	children
}: LaneHeadingProps) => (
	<div
		className={`${laneHeader} shrink-0 ${onToggle ? 'cursor-pointer hover:bg-bg-hover/30' : ''}`}
		onClick={onToggle}
		onContextMenu={
			onContextMenu &&
			(e => {
				e.preventDefault();
				onContextMenu(e.clientX, e.clientY);
			})
		}
	>
		{/* leading-none: the glyph's line box is taller than the label's,
		    and without it the heading sat 6px under its neighbours */}
		{onToggle && (
			<span
				className={`text-13 leading-none shrink-0 ${open ? 'text-accent' : 'text-text-muted'}`}
			>
				{open ? '▼' : '▶'}
			</span>
		)}
		<span className={`text-11 font-bold uppercase tracking-wider ${tone}`}>
			{label}
		</span>
		<span className='text-11 text-text-muted truncate'>{line}</span>
		<span className='flex-1' />
		{children}
	</div>
);

export default LaneHeading;
