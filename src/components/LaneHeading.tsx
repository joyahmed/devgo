import { laneHeader } from './rowStyles';

// the sticky heading every lane card wears: caps survive in exactly one
// place, the lane label, which is what makes it read as a heading over
// the workspace headings under it. a collapsing lane puts its arrow
// first and takes the click on the whole line
const LaneHeading = ({
	label,
	tone,
	line,
	open,
	onToggle,
	children
}: LaneHeadingProps) => (
	<div
		className={`${laneHeader} shrink-0 ${onToggle ? 'cursor-pointer hover:bg-bg-hover/30' : ''}`}
		onClick={onToggle}
		title={onToggle ? (open ? 'Collapse' : 'Expand') : undefined}
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
