// the refresh glyph, the same arrow on the project row and the github
// controls. it spins while the pass it started is still running
const RefreshIcon = ({ spinning = false, size = 15 }: RefreshIconProps) => (
	<svg
		width={size}
		height={size}
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
		className={spinning ? 'animate-spin' : ''}
	>
		<path d='M21 12a9 9 0 1 1-2.64-6.36' />
		<polyline points='21 3 21 9 15 9' />
	</svg>
);

export default RefreshIcon;
