import { useEffect, useRef, useState } from 'react';
import { scoreCommand } from '../palette';
import Button from './Button';

const RECENT_KEY = 'devgo.recentCommands';
const RECENT_MAX = 10;

const readRecent = (): string[] => {
	try {
		const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
		return Array.isArray(raw) ? (raw as string[]) : [];
	} catch {
		return [];
	}
};

// move to front, capped; ids not commands, a command is a closure over live state
const pushRecent = (id: string) => {
	const next = [id, ...readRecent().filter(x => x !== id)].slice(0, RECENT_MAX);
	localStorage.setItem(RECENT_KEY, JSON.stringify(next));
};

const divider =
	'px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted';

const CommandPalette = ({ commands, onClose }: CommandPaletteProps) => {
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);
	const activeRef = useRef<HTMLButtonElement>(null);

	// empty query: recents that are still runnable, then the rest; typed: best first
	const q = query.trim();
	const byId = new Map(commands.map(c => [c.id, c]));
	const recents = q
		? []
		: readRecent()
				.map(id => byId.get(id))
				.filter((c): c is PaletteCommand => !!c && !c.disabled);
	const recentIds = new Set(recents.map(c => c.id));
	const list: PaletteCommand[] = q
		? commands
				.map(c => ({ c, s: scoreCommand(q, c) }))
				.filter((x): x is { c: PaletteCommand; s: number } => x.s !== null)
				.sort((a, b) => b.s - a.s)
				.map(x => x.c)
		: [...recents, ...commands.filter(c => !recentIds.has(c.id))];
	const recentCount = recents.length;

	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: 'nearest' });
	}, [active]);

	// close before run, so a command that opens something opens on a clean screen
	const run = (cmd: PaletteCommand | undefined) => {
		if (!cmd || cmd.disabled) return;
		pushRecent(cmd.id);
		onClose();
		cmd.run();
	};

	const keys: Record<string, () => void> = {
		ArrowDown: () => setActive(i => Math.min(i + 1, list.length - 1)),
		ArrowUp: () => setActive(i => Math.max(i - 1, 0)),
		Enter: () => run(list[active]),
		Escape: onClose
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		const action = keys[e.key];
		if (!action) return;
		e.preventDefault();
		action();
	};

	const heading = (i: number) => {
		if (q || recentCount === 0) return null;
		if (i === 0) return 'Recent';
		if (i === recentCount) return 'All commands';
		return null;
	};

	return (
		<div
			className='fixed inset-0 bg-black/60 flex items-start justify-center z-50 pt-[12vh]'
			onClick={onClose}
		>
			<div
				className='w-[min(640px,92vw)] max-h-[70vh] flex flex-col bg-bg-secondary border border-border rounded-xl shadow-2xl overflow-hidden'
				onClick={e => e.stopPropagation()}
			>
				<input
					autoFocus
					className='w-full px-4 py-3 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted border-b border-border'
					placeholder='Type a command…'
					value={query}
					onChange={e => {
						// reset the cursor here, not in an effect
						setQuery(e.target.value);
						setActive(0);
					}}
					onKeyDown={handleKeyDown}
				/>

				<div className='flex-1 overflow-y-auto py-1'>
					{list.length === 0 && (
						<div className='px-4 py-6 text-center text-sm text-text-muted'>
							No matching commands
						</div>
					)}

					{list.map((cmd, i) => (
						<div key={cmd.id}>
							{heading(i) && <div className={divider}>{heading(i)}</div>}
							<Button
								ref={i === active ? activeRef : undefined}
								variant='tab'
								className='w-full rounded-none px-4 py-2'
								aria-current={i === active ? 'page' : undefined}
								disabled={cmd.disabled}
								onMouseMove={() => setActive(i)}
								onClick={() => run(cmd)}
							>
								<span className='flex w-full items-center justify-between gap-4'>
									<span className='min-w-0'>
										<span className='block truncate text-sm text-text-primary'>
											{cmd.title}
										</span>
										{cmd.subtitle && (
											<span className='block truncate text-xs text-text-muted'>
												{cmd.subtitle}
											</span>
										)}
									</span>
									{cmd.hint && (
										<kbd className='font-mono text-[10px] shrink-0 px-1.5 py-0.5 border border-border rounded bg-bg-panel text-text-muted'>
											{cmd.hint}
										</kbd>
									)}
								</span>
							</Button>
						</div>
					))}
				</div>
			</div>
		</div>
	);
};

export default CommandPalette;
