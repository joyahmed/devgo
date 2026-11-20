import Button from '../Button';
import type { StackAction, StackStatus, UseStack } from '../../hooks/useStack';

type StackRowProps = {
	name: string;
	index: number;
	last: boolean;
	status?: StackStatus;
	stack: UseStack;
};

const dotClass = (s?: StackStatus) =>
	s?.missing && !s.running
		? 'bg-danger'
		: s?.running
			? 'bg-accent'
			: 'border border-text-muted';

const stateWord = (s?: StackStatus) =>
	!s
		? 'checking'
		: s.missing && !s.running
			? 'not found'
			: s.running
				? 'running'
				: 'stopped';

const StackRow = ({ name, index, last, status, stack }: StackRowProps) => {
	const busy = !!(stack.busy[name] || stack.busy['*']);
	const running = !!status?.running;
	const actions: { action: StackAction; label: string; show: boolean }[] = [
		{ action: 'start', label: 'Start', show: !running },
		{ action: 'stop', label: 'Stop', show: running },
		{ action: 'restart', label: 'Restart', show: running }
	];
	const edits = [
		{ label: '↑', title: `Move ${name} up`, onClick: () => stack.move(index, -1), disabled: index === 0 },
		{ label: '↓', title: `Move ${name} down`, onClick: () => stack.move(index, 1), disabled: last },
		{ label: '✕', title: `Remove ${name}`, onClick: () => stack.remove(index), disabled: false }
	];

	return (
		<li className='flex items-center gap-2 h-9 px-3 border-b border-border'>
			<span className={`size-2 shrink-0 rounded-full ${dotClass(status)}`} aria-hidden />
			<span className='min-w-0 flex-1 truncate text-13 text-text-primary' title={`${name}: ${stateWord(status)}`}>
				{name}
			</span>
			<span className='sr-only'>{stateWord(status)}</span>
			{stack.editing ? (
				edits.map(e => (
					<Button key={e.label} variant='mini' aria-label={e.title} {...e}>
						{e.label}
					</Button>
				))
			) : status?.isSelf ? (
				<span className='text-11 text-text-muted'>this app</span>
			) : (
				actions
					.filter(a => a.show)
					.map(a => (
						<Button
							key={a.action}
							variant='mini'
							disabled={busy || (a.action === 'start' && !!status?.missing)}
							onClick={() => stack.act(name, a.action)}
						>
							{a.label}
						</Button>
					))
			)}
		</li>
	);
};

export default StackRow;
