import type { KeyboardEvent } from 'react';
import Button from './Button';

const SORT_LABEL: Record<SortMode, string> = {
	frecency: 'frecency',
	activity: 'activity',
	name: 'A–Z'
};

const SearchBox = ({
	value,
	onChange,
	onEnter,
	onArrow,
	enterHint,
	sortMode,
	onToggleSort,
	ref
}: SearchBoxProps) => {
	const keys: Record<string, (() => void) | undefined> = {
		ArrowDown: () => onArrow?.(1),
		ArrowUp: () => onArrow?.(-1),
		Escape: () => onChange(''),
		Enter: onEnter
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		// Bare keys only. Ctrl+Enter, Shift+Enter and Alt+Enter are project
		// actions declared in the shortcut table and owned by App's handler; if
		// this forwarded them as a plain Enter, one chord would launch twice.
		if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
		const action = keys[e.key];
		if (!action) return;
		e.preventDefault();
		action();
	};

	return (
		<div className='shrink-0'>
			<div className='flex items-baseline justify-between mb-2'>
				<label className='block text-xs font-semibold uppercase tracking-wider text-text-secondary'>
					Search Projects
				</label>
				{onToggleSort && (
					<Button
						variant='ghost'
						className='text-[10px] uppercase tracking-wider p-0 hover:text-accent hover:bg-transparent'
						title='Toggle sort order'
						onClick={onToggleSort}
					>
						sort: {SORT_LABEL[sortMode ?? 'frecency']}
					</Button>
				)}
			</div>
			<div className='relative bg-bg-panel rounded-lg border border-border focus-within:border-accent transition-colors'>
				<input
					ref={ref}
					type='text'
					// The launcher's whole job is to be typed into the instant it appears.
					autoFocus
					className='w-full py-2.5 pl-3.5 pr-20 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted'
					placeholder='Type to filter...'
					value={value}
					onChange={e => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
				/>
				<div className='absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5'>
					{value && (
						<Button
							variant='ghost'
							className='text-text-secondary'
							onClick={() => onChange('')}
						>
							&#10005;
						</Button>
					)}
					{enterHint && (
						<span className='text-[10px] text-text-muted px-1.5 py-0.5 border border-border rounded'>
							{enterHint}
						</span>
					)}
				</div>
			</div>
		</div>
	);
};

export default SearchBox;
