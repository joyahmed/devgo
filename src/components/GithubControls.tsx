import Button from './Button';
import RefreshIcon from './RefreshIcon';

// the github lane's three controls: recents, Repos ▾, refresh. one
// component in two places, so the row and the heading can never offer
// different controls. labelled is the row form, a bordered button on the
// command row's line (joy, of the shape: "like + Workspace button"); the
// heading form is the same words at heading scale, a heading being a line
// of text.
// ⭐ the + is gone from both forms and must not come back. this control
// has never added a repo on the click: it opens a menu, and of that
// menu's three entries only "By name…" is an add at all — "Clone repos…"
// copies remote repos onto disk and "Group repos…" organises repos
// already listed. a noun and a caret claim exactly what it does, which
// is why the glyph form needs no aria-label any more either: it has
// words of its own now
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
					variant={labelled ? 'menu' : 'ghost'}
					className={
						labelled ? 'shrink-0' : 'gap-1.5 text-11 px-1.5 py-0.5 -my-1 shrink-0'
					}
					// no title on the one control that opens a menu: a native tooltip
					// is an OS window above the webview, and this menu opens 4px under
					// the button, so the tooltip landed on top of its first item,
					// "Clone repos…" (alina, 1.2.2-rc2). no z-index can move it. the
					// menu spells all three actions out in words anyway, so the hint
					// said nothing the next frame did not
					onClick={e => {
						e.stopPropagation();
						const r = e.currentTarget.getBoundingClientRect();
						onAddMenu(r.left, r.bottom + 4);
					}}
				>
					<span className={`${labelled ? 'text-13' : 'text-11'} leading-none`}>
						Repos
					</span>
					<span className='text-11 leading-none opacity-70'>▾</span>
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
