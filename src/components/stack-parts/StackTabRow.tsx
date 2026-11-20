import Button from '../Button';
import StackAppIcon from './StackAppIcon';
import StackEditPanel from './StackEditPanel';
import StackRail from './StackRail';
import { stateOf, statusLine, type StackStatus } from '../../stackFormat';
import type { StackAction, StackEntry, UseStack } from '../../hooks/useStack';
import type { UseStackEditor } from '../../hooks/useStackEditor';

type StackTabRowProps = {
	app: StackEntry;
	index: number;
	count: number;
	status?: StackStatus;
	icon?: string | null;
	editing: boolean;
	stack: UseStack;
	editor: UseStackEditor;
};

// 24 viewBox, stroke 2, currentColor: the house icon style (StatusBar)
const TOOL_PATHS = {
	up: 'M18 15l-6-6-6 6',
	down: 'M6 9l6 6 6-6',
	edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
	remove: 'M18 6 6 18M6 6l12 12'
};

// the state word wears its dot's colour; the numbers after it stay quiet
const STATE_TONE = {
	checking: 'text-text-muted',
	running: 'text-emerald-300',
	stopped: 'text-danger',
	missing: 'text-text-secondary'
};

// a card is a panel; not installed is a dashed outline with nothing in it
// yet, and the row being edited lifts onto the hover ground with the accent
// edge (a fill and an edge, never an edge alone)
const cardClass = (state: keyof typeof STATE_TONE, editing: boolean) =>
	editing
		? 'border-accent bg-bg-hover/40 shadow-surface'
		: state === 'missing'
			? 'border-dashed border-border-strong bg-transparent'
			: 'border-border bg-bg-panel';

// one app on the timeline: the rail (when it starts, its state dot), the
// card (icon, name, what it is doing, the verbs), and the edit form folded
// under the card when this row is the one being edited
const StackTabRow = ({ app, index, count, status, icon, editing, stack, editor }: StackTabRowProps) => {
	const state = stateOf(status);
	const busy = !!(stack.busy[app.name] || stack.busy['*']);
	const [word, ...facts] = statusLine(status).split(' · ');
	if (state === 'missing') facts.push('install it, then Start');
	if (state === 'running' && facts.length) facts[0] = `up ${facts[0]}`;
	const runs: { action: StackAction; label: string; show: boolean; solid?: boolean }[] = [
		{ action: 'start', label: 'Start', show: state !== 'running', solid: state === 'stopped' },
		{ action: 'stop', label: 'Stop', show: state === 'running' },
		{ action: 'restart', label: 'Restart', show: state === 'running' }
	];
	const tools = [
		{ id: 'up', title: `Move ${app.name} earlier`, onClick: () => stack.move(index, -1), disabled: index === 0 },
		{ id: 'down', title: `Move ${app.name} later`, onClick: () => stack.move(index, 1), disabled: index === count - 1 },
		{ id: 'edit', title: `Edit ${app.name}`, onClick: () => (editing ? editor.cancel() : editor.startEdit(index)), disabled: false },
		{ id: 'remove', title: `Remove ${app.name} from the stack`, onClick: () => stack.remove(index), disabled: false }
	] as const;

	return (
		<li className='flex items-stretch'>
			<StackRail {...{ delay: app.delay, state, last: index === count - 1 }} />
			<div
				className={`flex-1 min-w-0 my-1.5 ml-3 rounded-panel border ${cardClass(state, editing)}`}
			>
				<div className='flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3'>
					<StackAppIcon name={app.name} icon={icon} />
					<div className='min-w-[10rem] flex-1'>
						<p className='flex items-center gap-2 min-w-0'>
							<span className='text-15 font-semibold text-text-primary truncate'>{app.name}</span>
							{status?.isSelf && (
								<span className='shrink-0 px-2 rounded-full bg-bg-raised text-11 font-semibold text-text-primary'>
									this app
								</span>
							)}
						</p>
						<p className='text-13 text-text-secondary'>
							<span className={`font-semibold ${STATE_TONE[state]}`}>{word}</span>
							{facts.map(f => ` · ${f}`).join('')}
						</p>
						<p className='font-mono text-11 text-text-muted truncate' title={app.path}>
							{app.path}
						</p>
					</div>
					<div className='flex items-center gap-2 ml-auto'>
						{!status?.isSelf &&
							runs
								.filter(r => r.show)
								.map(r => (
									<Button
										key={r.action}
										variant={r.solid ? 'solid' : 'quiet'}
										disabled={busy || state === 'missing' || state === 'checking'}
										onClick={() => stack.act(app.name, r.action)}
									>
										{r.label}
									</Button>
								))}
						<span className='flex items-center gap-0.5 pl-2 border-l border-border'>
							{tools.map(t => (
								<Button
									key={t.id}
									variant='ghost'
									className='size-8'
									title={t.title}
									aria-label={t.title}
									aria-pressed={t.id === 'edit' ? editing : undefined}
									onClick={t.onClick}
									disabled={t.disabled}
								>
									<svg
										width='16'
										height='16'
										viewBox='0 0 24 24'
										fill='none'
										stroke='currentColor'
										strokeWidth='2'
										strokeLinecap='round'
										strokeLinejoin='round'
										aria-hidden='true'
									>
										<path d={TOOL_PATHS[t.id]} />
									</svg>
								</Button>
							))}
						</span>
					</div>
				</div>
				{editing && <StackEditPanel editor={editor} />}
			</div>
		</li>
	);
};

export default StackTabRow;
