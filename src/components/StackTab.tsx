import Button from './Button';
import StackEditPanel from './stack-parts/StackEditPanel';
import StackEmpty from './stack-parts/StackEmpty';
import StackTabRow from './stack-parts/StackTabRow';
import { useStackTab } from '../hooks/useStackTab';

// the main window's Stack tab: the user's own apps on a sign-in timeline.
// mounted only while the tab is open (App lazy-loads it), so its 5 s poll
// with uptime and memory costs nothing the rest of the time
const StackTab = () => {
	const { stack, editor, summary, actions, adding, editingIndex } = useStackTab();
	const empty = stack.loaded && stack.apps.length === 0 && !adding;

	return (
		<section aria-label='My stack' className='flex-1 overflow-y-auto'>
			<div className='mx-auto w-full max-w-[1040px] flex flex-col gap-6 px-6 py-8'>
				<header className='flex flex-wrap items-end justify-between gap-4'>
					<div className='min-w-0'>
						<h1 className='text-24 font-bold text-text-primary'>My stack</h1>
						<p className='text-13 text-text-secondary'>{summary}</p>
					</div>
					<div className='flex flex-wrap items-center gap-2'>
						{actions.map(a => (
							<Button key={a.id} variant={a.variant} onClick={a.onClick} disabled={a.disabled}>
								{a.label}
							</Button>
						))}
					</div>
				</header>

				{stack.error && (
					<p
						role='alert'
						className='px-4 py-2.5 rounded-control border border-danger bg-bg-panel text-13 text-danger'
					>
						{stack.error}
					</p>
				)}

				{adding && (
					<div className='rounded-panel border border-accent bg-bg-panel'>
						<StackEditPanel editor={editor} />
					</div>
				)}

				{empty && <StackEmpty onAdd={editor.startAdd} picking={editor.picking} />}

				{stack.apps.length > 0 && (
					<ol aria-label='Start order'>
						<li aria-hidden='true' className='flex items-stretch h-8'>
							<div className='relative w-24 shrink-0 flex items-center justify-end gap-3 pr-1'>
								<span className='text-11 font-semibold text-accent'>sign-in</span>
								<span className='absolute right-[13px] top-1/2 bottom-0 w-0.5 bg-border-strong' />
								<span className='relative flex p-1 rounded-full bg-bg-primary'>
									<span className='size-3 rotate-45 bg-accent' />
								</span>
							</div>
						</li>
						{stack.apps.map((app, i) => (
							<StackTabRow
								key={app.name}
								{...{
									app,
									index: i,
									count: stack.apps.length,
									status: stack.status[app.name],
									icon: stack.icons[app.path],
									editing: editingIndex === i,
									stack,
									editor
								}}
							/>
						))}
					</ol>
				)}
			</div>
		</section>
	);
};

export default StackTab;
