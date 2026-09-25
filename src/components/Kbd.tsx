// one chip for every shortcut hint. text-13, a step up from the 11 it
// sat at: the arrows and ⏎ are drawn 9-19% shorter than letters, as thin
// outlines, and at 11 joy could not read them on the footer.
// leading-none so a label beside it shares its baseline. uppercase in
// css, by joy's call ("make all caps of text wherever we show shortcuts
// like ALT+ENTER"), so prettyKeys keeps feeding tooltips in normal case.
// filled with bg-raised, the one surface a step over its host: on
// bg-panel inside a bg-panel button it was invisible. with a real fill
// the edge goes quiet, two separations doing one job
const Kbd = ({ children }: KbdProps) => (
	<kbd className='font-mono text-13 font-semibold uppercase leading-none shrink-0 px-2 py-1 border border-border rounded-control bg-bg-raised text-text-primary'>
		{children}
	</kbd>
);

export default Kbd;
