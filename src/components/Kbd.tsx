// one chip for every shortcut hint. text-11 is the floor of the scale:
// the arrows and ⏎ are drawn 9-19% shorter than letters, as thin
// outlines, and vanished a step smaller.
// leading-none so a label beside it shares its baseline. uppercase in
// css, by joy's call ("make all caps of text wherever we show shortcuts
// like ALT+ENTER"), so prettyKeys keeps feeding tooltips in normal case
const Kbd = ({ children }: KbdProps) => (
	<kbd className='font-mono text-11 uppercase leading-none shrink-0 px-1.5 py-1 border border-border-strong rounded-control bg-bg-panel text-text-primary'>
		{children}
	</kbd>
);

export default Kbd;
