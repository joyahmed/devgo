import Button from './Button';
import RefreshIcon from './RefreshIcon';

// the github lane's three controls: recents, + Add repo, refresh. one
// component in two places, so the row and the heading can never offer
// different controls. labelled is the row form (joy: "the + should be a
// button containing Add Repo like + Workspace button"); the heading
// keeps the bare glyphs, a heading being a line of text
const GithubControls = ({
	github,
	onAddMenu,
	labelled = false
}: GithubControlsProps) => {
	const { payload, status, sections, showRecents, toggleRecents } = github;
	const total = payload?.cache.repos.length ?? 0;
	const canRefresh = Boolean(status?.login);
	const glyph = labelled ? 'w-9 h-9 shrink-0' : 'w-6 h-6 -my-1.5 shrink-0';
	return (
		<>
			{/* the recents switch: a word that reads as a state, on in the
			    accent and off in muted, like the local mark */}
			{total > 0 && sections && (
				<Button
					variant='ghost'
					className={`hover:bg-transparent shrink-0 ${labelled ? '' : '-my-1 p-0'}`}
					title={
						showRecents
							? 'Hide the recently updated repos not in a group'
							: 'Show the recently updated repos not in a group'
					}
					onClick={e => {
						e.stopPropagation();
						toggleRecents();
					}}
				>
					<span
						className={`hover:underline ${labelled ? 'text-13' : 'text-11'} ${
							showRecents ? 'text-accent' : 'text-text-muted'
						}`}
					>
						recents
					</span>
				</Button>
			)}
			{total > 0 && (
				<Button
					variant={labelled ? 'add' : 'ghost'}
					className={labelled ? 'shrink-0' : `${glyph} text-18 leading-none`}
					// no title on the one control that opens a menu: a native tooltip
					// is an OS window above the webview, and this menu opens 4px under
					// the button, so the tooltip landed on top of its first item,
					// "Clone repos…" (alina, 1.2.2-rc2). no z-index can move it. the
					// menu spells all three actions out in words anyway, so the hint
					// said nothing the next frame did not; aria-label keeps the glyph
					// form named for a screen reader, the labelled form has its own text
					aria-label={labelled ? undefined : 'Add repo'}
					onClick={e => {
						e.stopPropagation();
						const r = e.currentTarget.getBoundingClientRect();
						onAddMenu(r.left, r.bottom + 4);
					}}
				>
					<span className='text-18 leading-none'>+</span>
					{labelled && (
						<>
							<span className='text-13 font-semibold leading-none'>Add repo</span>
							<span className='text-11 leading-none opacity-70'>▾</span>
						</>
					)}
				</Button>
			)}
			{canRefresh && (
				<Button
					variant='ghost'
					className={glyph}
					title='Refresh from GitHub (runs gh)'
					disabled={github.refreshing}
					onClick={e => {
						e.stopPropagation();
						github.refresh();
					}}
				>
					<RefreshIcon
						{...{ spinning: github.refreshing, size: labelled ? 15 : 13 }}
					/>
				</Button>
			)}
		</>
	);
};

export default GithubControls;
