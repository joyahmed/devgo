import Button from './Button';
import RefreshIcon from './RefreshIcon';

// the github rows' three controls, on the search line beside their box
// (Joy: "we could put them on the same line of the search, and the +
// should be a button containing Add Repo like + Workspace"): recents,
// + Add repo, refresh. one place, so the header is a line of text again
const GithubControls = ({ github, onAddMenu }: GithubControlsProps) => {
	const { payload, status, sections, showRecents, toggleRecents } = github;
	const total = payload?.cache.repos.length ?? 0;
	const canRefresh = Boolean(status?.login);
	return (
		<>
			{/* the recents switch: a word that reads as a state, on in the
			    accent and off in muted, like the local mark */}
			{total > 0 && sections && (
				<Button
					variant='ghost'
					className='hover:bg-transparent shrink-0'
					title={
						showRecents
							? 'Hide the recently updated repos not in a group'
							: 'Show the recently updated repos not in a group'
					}
					onClick={toggleRecents}
				>
					<span
						className={`text-13 hover:underline ${
							showRecents ? 'text-accent' : 'text-text-muted'
						}`}
					>
						recents
					</span>
				</Button>
			)}
			{total > 0 && (
				<Button
					variant='ghost'
					className='gap-1 px-2 shrink-0'
					title='Clone repos into a workspace, add one by name, or group them'
					onClick={e => {
						const r = e.currentTarget.getBoundingClientRect();
						onAddMenu(r.left, r.bottom + 4);
					}}
				>
					<span className='text-18 leading-none'>+</span>
					<span className='text-13 font-semibold leading-none'>Add repo</span>
					<span className='text-11 leading-none opacity-70'>▾</span>
				</Button>
			)}
			{canRefresh && (
				<Button
					variant='ghost'
					className='w-7 h-7 shrink-0'
					title='Refresh from GitHub (runs gh)'
					disabled={github.refreshing}
					onClick={github.refresh}
				>
					<RefreshIcon {...{ spinning: github.refreshing, size: 13 }} />
				</Button>
			)}
		</>
	);
};

export default GithubControls;
