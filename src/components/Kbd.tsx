// one chip for every shortcut hint. text-[11px]: the arrows and ⏎ are drawn
// 9-19% shorter than letters, as thin outlines, and vanished at 10px.
// leading-none so a label beside it shares its baseline
const Kbd = ({ children }: KbdProps) => (
	<kbd className='font-mono text-[11px] leading-none shrink-0 px-2 py-1 border border-border-strong rounded bg-bg-panel text-text-primary'>
		{children}
	</kbd>
);

export default Kbd;
